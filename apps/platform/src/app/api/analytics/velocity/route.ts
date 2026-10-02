import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { getWeekRange, getPastWeeks, formatWeekLabel } from '@/lib/date-utils';
import { safeErrorResponse } from '@/lib/api-error';
import { cachedJson } from '@/lib/api-cache';
import { requireWorkspaceScope } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Workspace scope is required for velocity queries
    const wsScope = await requireWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    const supabase = await createClient();
    const weeksParam = request.nextUrl.searchParams.get('weeks');
    const weekCount = Math.min(Math.max(parseInt(weeksParam ?? '12', 10) || 12, 1), 52);
    const workspace_id = wsScope.workspace_id;
    const workspace_ids = wsScope.workspace_ids;

    // Only fetch tasks completed within the requested window
    const pastWeeks = getPastWeeks(weekCount);
    const windowStart = pastWeeks[pastWeeks.length - 1].start.toISOString();

    let query = supabase
      .from('tasks')
      .select('id, completed_at')
      .eq('status', 'done')
      .not('completed_at', 'is', null)
      .gte('completed_at', windowStart)
      .order('completed_at', { ascending: false })
      .limit(5000);

    if (workspace_ids && workspace_ids.length > 0) {
      query = query.in('workspace_id', workspace_ids);
    } else if (workspace_id) {
      query = query.eq('workspace_id', workspace_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Count completions per week
    const weekCounts = pastWeeks.map((week) => {
      const count = (data ?? []).filter((t) => {
        if (!t.completed_at) return false;
        const d = new Date(t.completed_at);
        return d >= week.start && d <= week.end;
      }).length;

      return {
        week: formatWeekLabel(week.start, week.end),
        start: week.start.toISOString(),
        end: week.end.toISOString(),
        count,
      };
    });

    // Reverse so oldest-first for charting
    const weeks = weekCounts.reverse();

    const thisWeekRange = getWeekRange(new Date());
    const lastWeekDate = new Date();
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);
    const lastWeekRange = getWeekRange(lastWeekDate);

    const thisWeek = (data ?? []).filter((t) => {
      if (!t.completed_at) return false;
      const d = new Date(t.completed_at);
      return d >= thisWeekRange.start && d <= thisWeekRange.end;
    }).length;

    const lastWeek = (data ?? []).filter((t) => {
      if (!t.completed_at) return false;
      const d = new Date(t.completed_at);
      return d >= lastWeekRange.start && d <= lastWeekRange.end;
    }).length;

    const totalCount = weeks.reduce((s, w) => s + w.count, 0);
    const avgPerWeek = weekCount > 0 ? Math.round((totalCount / weekCount) * 10) / 10 : 0;
    const delta = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : 0;

    return cachedJson({ weeks, thisWeek, lastWeek, avgPerWeek, delta });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
