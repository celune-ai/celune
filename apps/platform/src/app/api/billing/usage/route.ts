import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import type { UsageEventType } from '@repo/types';

export const dynamic = 'force-dynamic';

/** Human-readable labels for v2 event types */
const EVENT_TYPE_LABELS: Record<UsageEventType, string> = {
  task_executed: 'Tasks',
  tts_minutes: 'TTS',
  api_call: 'API Calls',
  llm_tokens: 'LLM Cost',
  storage_bytes: 'Storage',
  slack_ai_message: 'Slack AI Messages',
};

export interface UsageV2Summary {
  event_type: UsageEventType;
  label: string;
  total: number;
  period_start: string;
  period_end: string;
}

/**
 * GET /api/billing/usage?workspace_id=xxx
 * Returns aggregated usage for the current calendar month from the v2
 * usage_events pipeline. Optionally scoped to a workspace via ?workspace_id=.
 * Falls back to querying by user_id across all workspaces when no workspace_id
 * is supplied.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (workspaceId && !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const periodEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    ).toISOString();

    // Service client: reads usage_events, verifies workspace membership, counts agents for billing display.
    // Accesses: usage_events (via RPC), workspace_memberships, agent_configs.
    const service = createServiceClient();

    // Verify the user is a member of the requested workspace
    if (workspaceId) {
      const { data: membership } = await service
        .from('workspace_memberships')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.id)
        .single();

      if (!membership) {
        return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 });
      }
    }

    // Use sum_usage_events RPC to avoid Supabase 1000-row default limit
    let totals: Partial<Record<UsageEventType, number>> = {};

    if (workspaceId) {
      const { data: events } = await service.rpc('sum_usage_events', {
        p_workspace_id: workspaceId,
        p_since: periodStart,
      });

      for (const row of (events ?? []) as { event_type: string; total: number }[]) {
        totals[row.event_type as UsageEventType] = row.total;
      }
    } else {
      // Fall back to user-scoped aggregation when no workspace is provided
      const { data: events } = await service
        .from('usage_events')
        .select('event_type, quantity')
        .eq('user_id', user.id)
        .gte('created_at', periodStart)
        .lte('created_at', periodEnd);

      for (const row of events ?? []) {
        const et = row.event_type as UsageEventType;
        totals[et] = (totals[et] ?? 0) + (row.quantity as number);
      }
    }

    const usage: UsageV2Summary[] = (Object.keys(EVENT_TYPE_LABELS) as UsageEventType[]).map(
      (eventType) => ({
        event_type: eventType,
        label: EVENT_TYPE_LABELS[eventType],
        total: totals[eventType] ?? 0,
        period_start: periodStart,
        period_end: periodEnd,
      }),
    );

    // Count active agents for the workspace (not event-based, but plan-limited)
    let agentCount = 0;
    if (workspaceId) {
      const { count } = await service
        .from('agent_configs')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId);
      agentCount = count ?? 0;
    }

    return NextResponse.json({
      usage,
      agent_count: agentCount,
      period_start: periodStart,
      period_end: periodEnd,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
