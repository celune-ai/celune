import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { AGENTS, AGENT_COLORS } from '@/lib/agents-data';
import { TASK_ASSIGNEE_LABELS } from '@repo/types';
import { safeErrorResponse } from '@/lib/api-error';
import { cachedJson } from '@/lib/api-cache';
import { requireWorkspaceScope } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

/**
 * Per-agent health metrics: tasks completed, avg completion time,
 * cost, and efficiency (tasks per dollar).
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

    // All done tasks with metadata
    let doneQuery = supabase
      .from('tasks')
      .select('assignee, metadata, completed_at')
      .eq('status', 'done')
      .not('completed_at', 'is', null);

    if (workspace_ids && workspace_ids.length > 0) {
      doneQuery = doneQuery.in('workspace_id', workspace_ids);
    } else if (workspace_id) {
      doneQuery = doneQuery.eq('workspace_id', workspace_id);
    }

    const { data: doneTasks, error: doneErr } = await doneQuery;

    if (doneErr) throw doneErr;

    // Cost data per agent (workspace-filtered)
    let costQuery = supabase
      .from('claude_usage')
      .select('agent_name, total_cost_usd')
      .not('agent_name', 'is', null);

    if (workspace_ids && workspace_ids.length > 0) {
      costQuery = costQuery.in('workspace_id', workspace_ids);
    } else if (workspace_id) {
      costQuery = costQuery.eq('workspace_id', workspace_id);
    }

    const { data: costData, error: costErr } = await costQuery;

    if (costErr) throw costErr;

    // Aggregate cost by agent
    const costByAgent = new Map<string, number>();
    for (const row of costData ?? []) {
      const agent = row.agent_name as string;
      costByAgent.set(agent, (costByAgent.get(agent) ?? 0) + Number(row.total_cost_usd));
    }

    // Aggregate task metrics by agent
    const agentMetrics = new Map<
      string,
      { completed: number; totalHours: number; completedWithTime: number }
    >();

    for (const t of doneTasks ?? []) {
      const agent = (t.assignee as string) || 'unassigned';
      if (agent === 'unassigned') continue;

      const existing = agentMetrics.get(agent) ?? {
        completed: 0,
        totalHours: 0,
        completedWithTime: 0,
      };
      existing.completed++;

      const meta = t.metadata as Record<string, unknown> | null;
      const claimedAt = meta?.claimed_at as string | undefined;
      if (claimedAt && t.completed_at) {
        const hours =
          (new Date(t.completed_at).getTime() - new Date(claimedAt).getTime()) / (1000 * 60 * 60);
        if (hours > 0 && hours < 720) {
          existing.totalHours += hours;
          existing.completedWithTime++;
        }
      }

      agentMetrics.set(agent, existing);
    }

    // Build response
    const agents = Array.from(agentMetrics.entries())
      .map(([agentId, metrics]) => {
        const agentDef = AGENTS.find((a) => a.id === agentId);
        const color = AGENT_COLORS[agentId];
        const cost = costByAgent.get(agentId) ?? 0;
        const avgHours =
          metrics.completedWithTime > 0
            ? Math.round((metrics.totalHours / metrics.completedWithTime) * 10) / 10
            : null;
        const costPerTask =
          metrics.completed > 0 ? Math.round((cost / metrics.completed) * 10000) / 10000 : 0;
        const efficiency = cost > 0 ? Math.round((metrics.completed / cost) * 100) / 100 : 0;

        return {
          agent: agentId,
          label: labels[agentId] ?? agentDef?.name ?? agentId,
          color: color?.hex ?? '#6B7280',
          completed: metrics.completed,
          avgHours,
          totalCost: Math.round(cost * 10000) / 10000,
          costPerTask,
          efficiency, // tasks per dollar
        };
      })
      .sort((a, b) => b.completed - a.completed);

    return cachedJson({ agents }, 15);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
