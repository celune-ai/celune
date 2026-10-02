import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { extractWorkspaceScope, requireWorkspaceMembership } from '@/lib/require-workspace';
import { requirePermission } from '@/lib/permissions';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';
import { safeErrorResponse } from '@/lib/api-error';
import type { AgentMessage, MessageThread, MessageThreadResponse, MessageType } from '@repo/types';

export const dynamic = 'force-dynamic';

/**
 * Build message threads from activity_log entries that represent
 * inter-agent communication: delegations, reviews, discussions.
 */
function buildThreads(
  rows: Array<{
    id: string;
    event_type: string;
    agent_id: string | null;
    title: string;
    details: Record<string, unknown> | null;
    task_id: string | null;
    created_at: string;
  }>,
): MessageThread[] {
  // Group by task_id to form threads
  const threadMap = new Map<string, typeof rows>();

  for (const row of rows) {
    const key = row.task_id ?? row.id;
    const existing = threadMap.get(key);
    if (existing) {
      existing.push(row);
    } else {
      threadMap.set(key, [row]);
    }
  }

  const threads: MessageThread[] = [];

  for (const [key, entries] of threadMap) {
    const messages: AgentMessage[] = entries.map((row) => {
      const details = (row.details ?? {}) as Record<string, unknown>;
      let messageType: MessageType = 'discussion';
      if (row.event_type.includes('delegat')) messageType = 'delegation';
      if (row.event_type.includes('review') || row.event_type.includes('feedback'))
        messageType = 'review';

      return {
        id: row.id,
        from_agent: row.agent_id ?? 'system',
        from_agent_name: (details.agent_name as string) ?? row.agent_id ?? 'System',
        to_agent: (details.to_agent as string) ?? null,
        to_agent_name: (details.to_agent_name as string) ?? null,
        content:
          (details.message as string) ??
          (details.content as string) ??
          (details.outcome as string) ??
          row.title,
        message_type: messageType,
        task_id: row.task_id,
        created_at: row.created_at,
      };
    });

    // Sort messages chronologically within thread
    messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const participants = [
      ...new Set(messages.flatMap((m) => [m.from_agent, m.to_agent].filter(Boolean) as string[])),
    ];
    const firstEntry = entries[0];
    const details = (firstEntry.details ?? {}) as Record<string, unknown>;

    threads.push({
      id: key,
      participants,
      messages,
      task_id: firstEntry.task_id,
      project_id: (details.project_id as string) ?? null,
      title: (details.thread_title as string) ?? firstEntry.title,
      created_at: messages[0].created_at,
    });
  }

  // Sort threads by most recent activity
  threads.sort((a, b) => {
    const aLast = a.messages[a.messages.length - 1].created_at;
    const bLast = b.messages[b.messages.length - 1].created_at;
    return new Date(bLast).getTime() - new Date(aLast).getTime();
  });

  return threads;
}

export async function GET(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'agents.messages.get', RATE_READ);
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

    const searchParams = request.nextUrl.searchParams;
    const agentFilter = searchParams.get('agent') ?? undefined;
    const projectFilter = searchParams.get('project_id') ?? undefined;
    const cursor = searchParams.get('cursor') ?? undefined;
    const limit = Math.min(Number(searchParams.get('limit') ?? 30), 100);

    // Validate project_id if provided
    if (projectFilter && !isValidUuid(projectFilter)) {
      return NextResponse.json({ error: 'Invalid project_id' }, { status: 400 });
    }

    // Validate cursor as ISO timestamp if provided
    if (cursor && isNaN(Date.parse(cursor))) {
      return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
    }

    // Service client: reads activity_log for inter-agent messages; user membership verified above.
    const supabase = createServiceClient();

    // Validate agentFilter against known agent IDs for this workspace
    if (agentFilter) {
      const { data: agentConfigs } = await supabase
        .from('agent_configs')
        .select('agent_id')
        .in('workspace_id', wsIds);

      const knownAgentIds = new Set((agentConfigs ?? []).map((a) => a.agent_id).concat(['system']));

      if (!knownAgentIds.has(agentFilter)) {
        return NextResponse.json({ error: 'Invalid agent filter' }, { status: 400 });
      }
    }

    // Fetch enough rows for thread grouping, capped at 300 absolute max
    const MAX_RAW_FETCH = 300;
    const rawLimit = Math.min(limit * 3, MAX_RAW_FETCH);

    // Query activity_log for delegation, review, and inter-agent events
    let query = supabase
      .from('activity_log')
      .select('id, event_type, agent_id, title, details, task_id, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(rawLimit);

    // Workspace filter
    if (wsIds.length === 1) {
      query = query.eq('workspace_id', wsIds[0]);
    } else {
      query = query.in('workspace_id', wsIds);
    }

    // Filter to inter-agent event types (exact match for index usage)
    query = query.in('event_type', [
      'agent.delegated',
      'agent.delegation_complete',
      'agent.review_requested',
      'agent.review_complete',
      'agent.feedback',
      'agent.handoff',
      'agent.message',
      'agent.message_sent',
      'agent.message_received',
    ]);

    if (agentFilter) {
      query = query.eq('agent_id', agentFilter);
    }

    if (cursor) {
      query = query.lt('created_at', cursor);
    }

    const { data: rows, error: queryError, count } = await query;
    if (queryError) {
      return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
    }

    let threads = buildThreads(rows ?? []);

    // Apply project filter after thread building
    if (projectFilter) {
      threads = threads.filter((t) => t.project_id === projectFilter);
    }

    // Paginate threads
    const paginatedThreads = threads.slice(0, limit);
    const nextCursor =
      paginatedThreads.length === limit
        ? paginatedThreads[paginatedThreads.length - 1].messages[
            paginatedThreads[paginatedThreads.length - 1].messages.length - 1
          ].created_at
        : null;

    const response: MessageThreadResponse = {
      threads: paginatedThreads,
      nextCursor,
      total: threads.length,
    };

    return NextResponse.json(response);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
