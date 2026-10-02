import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { extractWorkspaceScope, requireWorkspaceMembership } from '@/lib/require-workspace';
import { requirePermission } from '@/lib/permissions';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';
import { safeErrorResponse } from '@/lib/api-error';
import type { ActivityFeedEntry, ActivityFeedResponse, FeedActionType } from '@repo/types';
import { FEED_ACTION_TYPES } from '@repo/types';

export const dynamic = 'force-dynamic';

/** Map activity_log event_type → FeedActionType */
function mapActionType(eventType: string): FeedActionType {
  if (eventType.includes('claimed') || eventType.includes('started')) return 'claimed';
  if (eventType.includes('completed') || eventType.includes('done')) return 'completed';
  if (eventType.includes('delegat')) return 'delegated';
  if (eventType.includes('review') || eventType.includes('feedback')) return 'reviewed';
  if (eventType.includes('milestone') || eventType.includes('sprint')) return 'milestone';
  if (eventType.includes('error') || eventType.includes('fail')) return 'error';
  if (eventType.includes('message') || eventType.includes('comment')) return 'message';
  return 'message';
}

/**
 * Reverse map: FeedActionType → event_type substring patterns.
 * Used to push action type filtering into the DB query via ilike.
 */
const ACTION_TYPE_PATTERNS: Record<FeedActionType, string[]> = {
  claimed: ['%claimed%', '%started%'],
  completed: ['%completed%', '%done%'],
  delegated: ['%delegat%'],
  reviewed: ['%review%', '%feedback%'],
  milestone: ['%milestone%', '%sprint%'],
  error: ['%error%', '%fail%'],
  message: ['%message%', '%comment%'],
};

/** Determine if an event is a milestone */
function isMilestone(eventType: string, details: Record<string, unknown> | null): boolean {
  if (eventType.includes('milestone') || eventType.includes('sprint')) return true;
  if (details?.is_milestone === true) return true;
  if (eventType.includes('project') && eventType.includes('completed')) return true;
  return false;
}

export async function GET(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'agents.activity.get', RATE_READ);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const wsScope = extractWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    const wsIds = 'workspace_ids' in wsScope ? wsScope.workspace_ids! : [wsScope.workspace_id!];
    for (const wsId of wsIds) {
      const membershipError = await requireWorkspaceMembership(userId, wsId);
      if (membershipError) return membershipError;
    }

    const workspaceId =
      'workspace_id' in wsScope
        ? (wsScope.workspace_id ?? null)
        : (wsScope.workspace_ids?.[0] ?? null);
    const permResult = await requirePermission(request, workspaceId, 'analytics:read');
    if (permResult instanceof NextResponse) return permResult;

    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const agentFilter = searchParams.get('agent') ?? undefined;
    const actionTypeFilter = searchParams.get('type') ?? undefined;
    const fromDate = searchParams.get('from') ?? undefined;
    const cursor = searchParams.get('cursor') ?? undefined;
    const limit = Math.min(Number(searchParams.get('limit') ?? 50), 100);

    // Validate action type filter if provided
    if (actionTypeFilter && !FEED_ACTION_TYPES.includes(actionTypeFilter as FeedActionType)) {
      return NextResponse.json({ error: 'Invalid action type filter' }, { status: 400 });
    }

    // Service client: reads activity_log filtered by workspace; user membership already verified above.
    const supabase = createServiceClient();

    let query = supabase
      .from('activity_log')
      .select('id, event_type, agent_id, title, details, task_id, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(limit);

    // Workspace filter
    if (wsIds.length === 1) {
      query = query.eq('workspace_id', wsIds[0]);
    } else {
      query = query.in('workspace_id', wsIds);
    }

    // Agent filter
    if (agentFilter) {
      query = query.eq('agent_id', agentFilter);
    }

    // Action type filter — push into DB query via event_type ilike patterns
    if (actionTypeFilter) {
      const patterns = ACTION_TYPE_PATTERNS[actionTypeFilter as FeedActionType];
      if (patterns && patterns.length > 0) {
        // Build OR filter: event_type ilike any of the patterns
        const orClauses = patterns.map((p) => `event_type.ilike.${p}`).join(',');
        query = query.or(orClauses);
      }
    }

    // Date filter
    if (fromDate) {
      query = query.gte('created_at', fromDate);
    }

    // Cursor-based pagination (cursor = created_at of last item)
    if (cursor) {
      query = query.lt('created_at', cursor);
    }

    const { data: rows, error: queryError, count } = await query;
    if (queryError) {
      return NextResponse.json({ error: 'Failed to fetch activity' }, { status: 500 });
    }

    const entries: ActivityFeedEntry[] = [];
    for (const row of rows ?? []) {
      const details = (row.details ?? {}) as Record<string, unknown>;
      const actionType = mapActionType(row.event_type);

      entries.push({
        id: row.id,
        agent_id: row.agent_id ?? 'system',
        agent_name: (details.agent_name as string) ?? row.agent_id ?? 'System',
        action_type: actionType,
        title: row.title,
        summary: (details.summary as string) ?? null,
        reasoning: (details.reasoning as string) ?? (details.outcome as string) ?? null,
        task_id: row.task_id ?? null,
        project_id: (details.project_id as string) ?? null,
        is_milestone: isMilestone(row.event_type, details),
        created_at: row.created_at,
      });
    }

    const hasMore = entries.length === limit;
    const nextCursor = hasMore ? entries[entries.length - 1].created_at : null;

    const response: ActivityFeedResponse = {
      entries,
      nextCursor,
      total: count ?? entries.length,
    };

    return NextResponse.json(response);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
