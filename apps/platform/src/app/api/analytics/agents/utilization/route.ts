import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { getAgentIds, getAgent, AGENT_COLORS } from '@/lib/agents-data';
import { TASK_ASSIGNEE_LABELS } from '@repo/types';
import { safeErrorResponse } from '@/lib/api-error';
import { cachedJson } from '@/lib/api-cache';
import { extractWorkspaceScope, requireWorkspaceMembership } from '@/lib/require-workspace';
import { getAuthUserId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface AgentUtilization {
  agent: string;
  label: string;
  color: string;
  queueDepth: number;
  inProgress: number;
  completed7d: number;
  avgMinutes: number | null;
}

/**
 * Per-agent utilization metrics: queue depth, in-progress count,
 * completed tasks (last 7 days), and average completion time.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const wsScope = extractWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    // Verify membership for each workspace
    if (wsScope.workspace_id) {
      const membershipErr = await requireWorkspaceMembership(userId, wsScope.workspace_id);
      if (membershipErr) return membershipErr;
    }
    if (wsScope.workspace_ids) {
      for (const wsId of wsScope.workspace_ids) {
        const membershipErr = await requireWorkspaceMembership(userId, wsId);
        if (membershipErr) return membershipErr;
      }
    }

    const supabase = await createClient();
    const labels = TASK_ASSIGNEE_LABELS as Record<string, string>;
    const workspace_id = wsScope.workspace_id;
    const workspace_ids = wsScope.workspace_ids;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Query all non-done tasks (queue) per agent
    let queueQuery = supabase
      .from('tasks')
      .select('assignee, status')
      .in('status', ['inbox', 'assigned', 'planning', 'in_progress', 'review']);

    if (workspace_ids && workspace_ids.length > 0) {
      queueQuery = queueQuery.in('workspace_id', workspace_ids);
    } else if (workspace_id) {
      queueQuery = queueQuery.eq('workspace_id', workspace_id);
    }

    const { data: queueTasks, error: queueErr } = await queueQuery;
    if (queueErr) throw queueErr;

    // Query completed tasks in last 7 days with timing
    let doneQuery = supabase
      .from('tasks')
      .select('assignee, metadata, completed_at')
      .eq('status', 'done')
      .not('completed_at', 'is', null)
      .gte('completed_at', sevenDaysAgo);

    if (workspace_ids && workspace_ids.length > 0) {
      doneQuery = doneQuery.in('workspace_id', workspace_ids);
    } else if (workspace_id) {
      doneQuery = doneQuery.eq('workspace_id', workspace_id);
    }

    const { data: doneTasks, error: doneErr } = await doneQuery;
    if (doneErr) throw doneErr;

    // Aggregate per agent
    const agents: AgentUtilization[] = getAgentIds().map((id) => {
      const agentDef = getAgent(id);
      const queue = (queueTasks || []).filter(
        (t) => t.assignee === id && t.status !== 'in_progress',
      );
      const inProgress = (queueTasks || []).filter(
        (t) => t.assignee === id && t.status === 'in_progress',
      );
      const completed = (doneTasks || []).filter((t) => t.assignee === id);

      // Calculate average completion time in minutes
      const durations: number[] = [];
      for (const t of completed) {
        const meta = (t.metadata as Record<string, unknown>) || {};
        const claimedAt = meta.claimed_at as string | undefined;
        if (claimedAt && t.completed_at) {
          const mins = (new Date(t.completed_at).getTime() - new Date(claimedAt).getTime()) / 60000;
          if (mins > 0 && mins < 10080) durations.push(mins); // cap at 7 days
        }
      }

      const avgMinutes =
        durations.length > 0
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : null;

      return {
        agent: id,
        label: labels[id] || agentDef?.name || id,
        color: AGENT_COLORS[id]?.hex || 'var(--color-muted)',
        queueDepth: queue.length,
        inProgress: inProgress.length,
        completed7d: completed.length,
        avgMinutes,
      };
    });

    // Filter out agents with zero activity
    const active = agents.filter((a) => a.queueDepth > 0 || a.inProgress > 0 || a.completed7d > 0);

    return cachedJson({ agents: active }, 120);
  } catch (err) {
    return safeErrorResponse(err);
  }
}
