import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { safeErrorResponse } from '@/lib/api-error';
import { cachedJson } from '@/lib/api-cache';
import { requireWorkspaceScope } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#F04438',
  high: '#F59E0B',
  normal: '#34B27B',
  low: '#3B82F6',
};

const PRIORITY_ORDER = ['urgent', 'high', 'normal', 'low'];

export async function GET(request: NextRequest) {
  try {
    // Workspace scope is required
    const wsScope = await requireWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    const supabase = await createClient();
    const workspace_id = wsScope.workspace_id;
    const workspace_ids = wsScope.workspace_ids;

    // Run parallel count queries per priority — avoids fetching all rows
    const priorityQueries = PRIORITY_ORDER.map(async (p) => {
      let q = supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'done')
        .eq('priority', p);

      if (workspace_ids && workspace_ids.length > 0) {
        q = q.in('workspace_id', workspace_ids);
      } else if (workspace_id) {
        q = q.eq('workspace_id', workspace_id);
      }

      const { count, error: qErr } = await q;
      if (qErr) throw qErr;
      return { priority: p, count: count ?? 0 };
    });

    const results = await Promise.all(priorityQueries);
    const countMap = new Map<string, number>();
    for (const r of results) {
      if (r.count > 0) countMap.set(r.priority, r.count);
    }

    const priorities = PRIORITY_ORDER.filter((p) => countMap.has(p)).map((p) => ({
      name: p.charAt(0).toUpperCase() + p.slice(1),
      value: countMap.get(p) ?? 0,
      color: PRIORITY_COLORS[p] ?? '#34B27B',
    }));

    return cachedJson({ priorities });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
