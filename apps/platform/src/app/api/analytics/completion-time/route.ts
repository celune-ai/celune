import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { TASK_ASSIGNEE_LABELS } from '@repo/types';
import { safeErrorResponse } from '@/lib/api-error';
import { cachedJson } from '@/lib/api-cache';
import { requireWorkspaceScope } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

/**
 * Returns time-to-completion data (claimed_at → completed_at) grouped by agent.
 * Also returns stale task counts (in_progress >24h or inbox >3d).
 */
export async function GET(request: NextRequest) {
  try {
    // Workspace scope is required
    const wsScope = await requireWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    const supabase = await createClient();
    const labels = TASK_ASSIGNEE_LABELS as Record<string, string>;
    const workspace_id = wsScope.workspace_id;
    const workspace_ids = wsScope.workspace_ids;

    // Tasks with both claimed_at and completed_at
    let doneQuery = supabase
      .from('tasks')
      .select('assignee, metadata, completed_at')
      .eq('status', 'done')
      .not('completed_at', 'is', null)
      .limit(5000);

    if (workspace_ids && workspace_ids.length > 0) {
      doneQuery = doneQuery.in('workspace_id', workspace_ids);
    } else if (workspace_id) {
      doneQuery = doneQuery.eq('workspace_id', workspace_id);
    }

    const { data: doneTasks, error: doneErr } = await doneQuery;

    if (doneErr) throw doneErr;

    // Compute per-agent avg completion hours
    const agentTotals = new Map<string, { totalHours: number; count: number }>();
    for (const t of doneTasks ?? []) {
      const meta = t.metadata as Record<string, unknown> | null;
      const claimedAt = meta?.claimed_at as string | undefined;
      if (!claimedAt || !t.completed_at) continue;
      const hours =
        (new Date(t.completed_at).getTime() - new Date(claimedAt).getTime()) / (1000 * 60 * 60);
      if (hours <= 0 || hours > 720) continue; // skip nonsensical values
      const agent = (t.assignee as string) || 'unassigned';
      const existing = agentTotals.get(agent) ?? { totalHours: 0, count: 0 };
      agentTotals.set(agent, {
        totalHours: existing.totalHours + hours,
        count: existing.count + 1,
      });
    }

    const byAgent = Array.from(agentTotals.entries())
      .map(([agent, { totalHours, count }]) => ({
        agent,
        label: labels[agent] ?? agent,
        avgHours: Math.round((totalHours / count) * 10) / 10,
        count,
      }))
      .sort((a, b) => b.avgHours - a.avgHours);

    // Stale tasks: in_progress >24h or inbox >3d
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

    let staleInProgressQuery = supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'in_progress')
      .lt('updated_at', oneDayAgo);

    let staleInboxQuery = supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'inbox')
      .lt('created_at', threeDaysAgo);

    if (workspace_ids && workspace_ids.length > 0) {
      staleInProgressQuery = staleInProgressQuery.in('workspace_id', workspace_ids);
      staleInboxQuery = staleInboxQuery.in('workspace_id', workspace_ids);
    } else if (workspace_id) {
      staleInProgressQuery = staleInProgressQuery.eq('workspace_id', workspace_id);
      staleInboxQuery = staleInboxQuery.eq('workspace_id', workspace_id);
    }

    const [{ count: staleInProgress }, { count: staleInbox }] = await Promise.all([
      staleInProgressQuery,
      staleInboxQuery,
    ]);

    return cachedJson({
      byAgent,
      staleCount: (staleInProgress ?? 0) + (staleInbox ?? 0),
      staleInProgress: staleInProgress ?? 0,
      staleInbox: staleInbox ?? 0,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
