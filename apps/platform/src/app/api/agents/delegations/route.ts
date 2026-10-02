import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { safeErrorResponse } from '@/lib/api-error';
import { extractWorkspaceScope } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

interface DelegationEdge {
  from: string;
  to: string;
  count: number;
  tasks: { id: string; title: string; delegated_at: string }[];
}

/**
 * Returns delegation flow data: edges between agents where tasks were handed off.
 * Reads metadata.delegated_by from tasks table.
 */
export async function GET(request: NextRequest) {
  try {
    // Workspace scope is required for delegation queries
    const wsScope = extractWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    const supabase = await createClient();

    // Fetch tasks that have delegation metadata
    let query = supabase
      .from('tasks')
      .select('id, title, assignee, metadata')
      .not('metadata', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(500);
    if (wsScope.workspace_ids) {
      query = query.in('workspace_id', wsScope.workspace_ids);
    } else {
      query = query.eq('workspace_id', wsScope.workspace_id!);
    }

    const { data, error } = await query;

    if (error) throw error;

    const edgeMap = new Map<string, DelegationEdge>();

    for (const task of data ?? []) {
      const meta =
        typeof task.metadata === 'string'
          ? (() => {
              try {
                return JSON.parse(task.metadata);
              } catch {
                return null;
              }
            })()
          : task.metadata;

      if (!meta?.delegated_by || !task.assignee) continue;

      const from = meta.delegated_by.toLowerCase();
      const to = task.assignee.toLowerCase();
      if (from === to) continue;

      const key = `${from}->${to}`;
      const existing = edgeMap.get(key);

      if (existing) {
        existing.count++;
        if (existing.tasks.length < 5) {
          existing.tasks.push({
            id: task.id,
            title: task.title,
            delegated_at: meta.delegated_at ?? '',
          });
        }
      } else {
        edgeMap.set(key, {
          from,
          to,
          count: 1,
          tasks: [
            {
              id: task.id,
              title: task.title,
              delegated_at: meta.delegated_at ?? '',
            },
          ],
        });
      }
    }

    // Also compute per-agent stats
    const agentStats: Record<string, { delegated_out: number; received: number }> = {};
    for (const edge of edgeMap.values()) {
      if (!agentStats[edge.from]) agentStats[edge.from] = { delegated_out: 0, received: 0 };
      if (!agentStats[edge.to]) agentStats[edge.to] = { delegated_out: 0, received: 0 };
      agentStats[edge.from].delegated_out += edge.count;
      agentStats[edge.to].received += edge.count;
    }

    return NextResponse.json({
      edges: Array.from(edgeMap.values()),
      stats: agentStats,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
