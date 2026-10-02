import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { AGENTS, AGENT_COLORS } from '@/lib/agents-data';
import { safeErrorResponse } from '@/lib/api-error';
import { cachedJson } from '@/lib/api-cache';
import { requireWorkspaceScope } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Workspace scope is required
    const wsScope = await requireWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    const supabase = await createClient();
    const workspace_id = wsScope.workspace_id;
    const workspace_ids = wsScope.workspace_ids;

    let query = supabase.from('tasks').select('id, assignee, metadata').eq('status', 'done');

    if (workspace_ids && workspace_ids.length > 0) {
      query = query.in('workspace_id', workspace_ids);
    } else if (workspace_id) {
      query = query.eq('workspace_id', workspace_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Count by the agent who completed the task (metadata.completed_by preferred, fall back to assignee)
    const countMap = new Map<string, number>();

    for (const task of data ?? []) {
      const completedBy =
        (task.metadata as Record<string, unknown> | null)?.completed_by ?? task.assignee;
      const agentId = typeof completedBy === 'string' ? completedBy : task.assignee;
      if (!agentId || agentId === 'unassigned') continue;
      countMap.set(agentId, (countMap.get(agentId) ?? 0) + 1);
    }

    // Build sorted agent list
    const agents = Array.from(countMap.entries())
      .map(([agentId, count]) => {
        const agentDef = AGENTS.find((a) => a.id === agentId);
        const color = AGENT_COLORS[agentId];
        return {
          agent: agentId,
          label: agentDef?.name ?? agentId,
          count,
          color: color?.hex ?? '#34B27B',
        };
      })
      .sort((a, b) => b.count - a.count);

    return cachedJson({ agents });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
