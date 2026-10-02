import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { safeErrorResponse } from '@/lib/api-error';
import { cachedJson } from '@/lib/api-cache';
import { requireWorkspaceScope } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

/**
 * Error analytics.
 * Returns daily error counts and breakdown by event type.
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
      .select('severity, event_type, created_at')
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
    const daily: Array<{ date: string; errors: number; total: number }> = [];

    for (let i = days - 1; i >= 0; i--) {
      const dayStart = new Date(now);
      dayStart.setDate(dayStart.getDate() - i);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const dayEvents = (data ?? []).filter((e) => {
        const d = new Date(e.created_at);
        return d >= dayStart && d <= dayEnd;
      });

      daily.push({
        date: dayStart.toISOString().slice(0, 10),
        errors: dayEvents.filter((e) => e.severity === 'error').length,
        total: dayEvents.length,
      });
    }

    // Breakdown by event type (errors only)
    const errorsByType: Record<string, number> = {};
    for (const e of data ?? []) {
      if (e.severity === 'error') {
        const type = (e.event_type as string) || 'unknown';
        errorsByType[type] = (errorsByType[type] ?? 0) + 1;
      }
    }

    const breakdown = Object.entries(errorsByType)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    return cachedJson({ daily, breakdown });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
