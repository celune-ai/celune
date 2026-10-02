import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { safeErrorResponse } from '@/lib/api-error';
import { cachedJson } from '@/lib/api-cache';
import { requireWorkspaceScope } from '@/lib/require-workspace';
import { computeOverviewMetrics } from '@/lib/analytics/overview';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Workspace scope is required for overview queries
    const wsScope = await requireWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    const supabase = await createClient();
    const workspace_id = wsScope.workspace_id;
    const workspace_ids = wsScope.workspace_ids;

    let query = supabase
      .from('tasks')
      .select('id, status, completed_at, due_date, source')
      .neq('status', 'archived');

    if (workspace_ids && workspace_ids.length > 0) {
      query = query.in('workspace_id', workspace_ids);
    } else if (workspace_id) {
      query = query.eq('workspace_id', workspace_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    const metrics = computeOverviewMetrics(data ?? [], { includeSourceBreakdown: true });
    return cachedJson(metrics);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
