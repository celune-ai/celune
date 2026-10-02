import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { safeErrorResponse } from '@/lib/api-error';
import { cachedJson } from '@/lib/api-cache';
import { requireWorkspaceScope } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

/**
 * Agent utilization data.
 * Returns a matrix of agent activity by day of week (Mon-Sun).
 */
export async function GET(request: NextRequest) {
  try {
    // Workspace scope is required
    const wsScope = await requireWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    const supabase = await createClient();
    const searchParams = request.nextUrl.searchParams;
    const daysParam = searchParams.get('days');
    const days = Math.min(Math.max(parseInt(daysParam ?? '30', 10) || 30, 7), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const workspace_id = wsScope.workspace_id;
    const workspace_ids = wsScope.workspace_ids;

    let query = supabase
      .from('activity_log')
      .select('agent_id, created_at')
      .gte('created_at', since)
      .not('agent_id', 'is', null)
      .limit(10000);
    if (workspace_ids && workspace_ids.length > 0) {
      query = query.in('workspace_id', workspace_ids);
    } else if (workspace_id) {
      query = query.eq('workspace_id', workspace_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Group by agent_id and day of week (0=Mon, 6=Sun)
    const matrix: Record<string, number[]> = {};

    for (const row of data ?? []) {
      const agent = row.agent_id as string;
      if (!agent) continue;
      if (!matrix[agent]) matrix[agent] = [0, 0, 0, 0, 0, 0, 0];

      const d = new Date(row.created_at);
      const jsDay = d.getDay(); // 0=Sun, 6=Sat
      const monDay = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon, 6=Sun
      matrix[agent][monDay]++;
    }

    // Convert to array format sorted by agent name
    const agents = Object.entries(matrix)
      .map(([agent_id, values]) => ({ agent_id, values }))
      .sort((a, b) => a.agent_id.localeCompare(b.agent_id));

    return cachedJson({ agents, days });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
