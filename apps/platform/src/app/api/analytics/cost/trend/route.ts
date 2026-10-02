import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { safeErrorResponse } from '@/lib/api-error';
import { cachedJson } from '@/lib/api-cache';
import { requireWorkspaceScope } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

/**
 * Cost trend by model over time.
 * Returns daily cost broken down by model for stacked area chart.
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
      .from('claude_usage')
      .select('model, total_cost_usd, created_at')
      .gte('created_at', since)
      .limit(10000);

    if (workspace_ids && workspace_ids.length > 0) {
      query = query.in('workspace_id', workspace_ids);
    } else if (workspace_id) {
      query = query.eq('workspace_id', workspace_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    const now = new Date();
    const daily: Array<{ date: string; opus: number; sonnet: number; haiku: number }> = [];

    for (let i = days - 1; i >= 0; i--) {
      const dayStart = new Date(now);
      dayStart.setDate(dayStart.getDate() - i);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const dayRows = (data ?? []).filter((r) => {
        const d = new Date(r.created_at);
        return d >= dayStart && d <= dayEnd;
      });

      const bucket = { date: dayStart.toISOString().slice(5, 10), opus: 0, sonnet: 0, haiku: 0 };

      for (const row of dayRows) {
        const model = ((row.model as string) ?? '').toLowerCase();
        const cost = row.total_cost_usd ?? 0;
        if (model.includes('opus')) bucket.opus += cost;
        else if (model.includes('haiku')) bucket.haiku += cost;
        else bucket.sonnet += cost; // default bucket for sonnet + unknown
      }

      // Round to 2 decimal places
      bucket.opus = Math.round(bucket.opus * 100) / 100;
      bucket.sonnet = Math.round(bucket.sonnet * 100) / 100;
      bucket.haiku = Math.round(bucket.haiku * 100) / 100;

      daily.push(bucket);
    }

    return cachedJson({ daily });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
