import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
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

    const { data, error } = await supabase.rpc('analytics_cost_aggregates', {
      p_workspace_id: workspace_id ?? null,
      p_workspace_ids: workspace_ids ?? null,
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;

    return cachedJson({
      totalTokens: Number(row?.total_tokens ?? 0),
      totalCost: Number(row?.total_cost ?? 0),
      totalTimeMinutes: Number(row?.total_time_minutes ?? 0),
      handoffCount: Number(row?.handoff_count ?? 0),
      tasksWithCost: Number(row?.tasks_with_cost ?? 0),
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
