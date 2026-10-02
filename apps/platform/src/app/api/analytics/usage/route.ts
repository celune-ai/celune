import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { cachedJson } from '@/lib/api-cache';
import { requireWorkspaceScope } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

/**
 * Usage analytics endpoint.
 * Returns usage summaries for a workspace, with optional period and metric filtering.
 *
 * Query params:
 *   workspace_id - single workspace (required)
 *   workspace_ids - comma-separated for aggregation (required if workspace_id not set)
 *   period - 'daily' | 'monthly' (default: 'daily')
 *   metric - filter to specific metric
 *   days - number of days to look back (default: 30)
 */
export async function GET(request: NextRequest) {
  try {
    // Workspace scope is required
    const wsScope = await requireWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    const supabase = await createClient();
    const searchParams = request.nextUrl.searchParams;
    const workspace_id = wsScope.workspace_id;
    const workspace_ids = wsScope.workspace_ids;
    const period = searchParams.get('period') ?? 'daily';
    const metric = searchParams.get('metric') ?? undefined;
    const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '30', 10) || 30, 1), 365);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Build both queries, then run in parallel
    let summaryQuery = supabase
      .from('usage_summaries')
      .select(
        'id, workspace_id, org_id, period_type, period_start, metric, total, metadata, created_at',
      )
      .eq('period_type', period)
      .gte('period_start', since)
      .order('period_start', { ascending: false })
      .limit(1000);

    if (workspace_ids && workspace_ids.length > 0) {
      summaryQuery = summaryQuery.in('workspace_id', workspace_ids);
    } else if (workspace_id) {
      summaryQuery = summaryQuery.eq('workspace_id', workspace_id);
    }

    if (metric) {
      summaryQuery = summaryQuery.eq('metric', metric);
    }

    // Current period totals via sum_usage_events RPC (database-level GROUP BY)
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStartISO = monthStart.toISOString();

    const targetIds =
      workspace_ids && workspace_ids.length > 0
        ? workspace_ids
        : workspace_id
          ? [workspace_id]
          : [];

    // Service client: sum_usage_events is not executable by user roles; requireWorkspaceScope checked membership. Accesses: usage_events via sum_usage_events.
    const service = createServiceClient();
    // Run summary query + RPC calls in parallel
    const [{ data, error }, ...rpcResults] = await Promise.all([
      summaryQuery,
      ...targetIds.map((wsId) =>
        service.rpc('sum_usage_events', {
          p_workspace_id: wsId,
          p_since: monthStartISO,
        }),
      ),
    ]);
    if (error) throw error;

    // Merge RPC results into a single map (skip any partial failures)
    const currentMonth: Record<string, number> = {};
    for (const result of rpcResults) {
      if (result.error) {
        console.warn('[usage] RPC partial failure, skipping workspace:', result.error.message);
        continue;
      }
      if (!Array.isArray(result.data)) continue;
      for (const row of result.data) {
        const key = row.event_type as string;
        currentMonth[key] = (currentMonth[key] ?? 0) + Number(row.total);
      }
    }

    return cachedJson({
      summaries: data ?? [],
      current_month: currentMonth,
      period,
      days,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
