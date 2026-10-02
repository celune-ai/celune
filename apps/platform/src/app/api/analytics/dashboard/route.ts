import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { cachedJson } from '@/lib/api-cache';
import { requireWorkspaceScope } from '@/lib/require-workspace';
import { getAuthUserId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Unified dashboard KPI endpoint.
 * Returns headline metrics for the Health dashboard KPI strip.
 */
export async function GET(request: NextRequest) {
  try {
    // Workspace scope is required for dashboard KPI queries
    const wsScope = await requireWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    const supabase = await createClient();
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const workspace_id = wsScope.workspace_id;
    const workspace_ids = wsScope.workspace_ids;

    // Build count queries (already efficient — head:true)
    let q1 = supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'done')
      .gte('completed_at', sevenDaysAgo);
    let q2 = supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'done')
      .gte('completed_at', fourteenDaysAgo)
      .lt('completed_at', sevenDaysAgo);
    let q8 = supabase
      .from('activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('severity', 'error')
      .gte('created_at', sevenDaysAgo);
    let q9 = supabase
      .from('activity_log')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sevenDaysAgo);

    // q10: avg completion time — still needs row-level metadata access
    // but only fetches the two fields needed (not full row)
    let q10 = supabase
      .from('tasks')
      .select('metadata->claimed_at, updated_at')
      .eq('status', 'done')
      .gte('updated_at', thirtyDaysAgo)
      .not('metadata->claimed_at', 'is', null);

    // Apply workspace filters to count queries
    if (workspace_ids && workspace_ids.length > 0) {
      q1 = q1.in('workspace_id', workspace_ids);
      q2 = q2.in('workspace_id', workspace_ids);
      q8 = q8.in('workspace_id', workspace_ids);
      q9 = q9.in('workspace_id', workspace_ids);
      q10 = q10.in('workspace_id', workspace_ids);
    } else if (workspace_id) {
      q1 = q1.eq('workspace_id', workspace_id);
      q2 = q2.eq('workspace_id', workspace_id);
      q8 = q8.eq('workspace_id', workspace_id);
      q9 = q9.eq('workspace_id', workspace_id);
      q10 = q10.eq('workspace_id', workspace_id);
    }

    // RPC params for workspace scoping
    const rpcParams = {
      p_workspace_id: workspace_id ?? null,
      p_workspace_ids: workspace_ids ?? null,
    };

    // Agent status is platform-level data (no workspace_id column).
    // Only fetch for platform owner; other users see 0 agents.
    let isPlatformOwner = false;
    const userId = getAuthUserId(request);
    if (userId) {
      const svc = createServiceClient();
      const { data: userRole } = await svc
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .single();
      isPlatformOwner = userRole?.role === 'owner';
    }

    // Run all queries in parallel — RPCs replace row-fetching queries
    const [
      { count: completedThisWeek },
      { count: completedLastWeek },
      agentStatusResult,
      { data: dailyCompletions, error: dcErr },
      { data: costThisWeekData, error: ctErr },
      { data: costLastWeekData, error: clErr },
      { data: dailyCosts, error: dCostErr },
      { count: errorCount },
      { count: totalEvents },
      { data: completedTasks },
    ] = await Promise.all([
      q1,
      q2,
      isPlatformOwner
        ? supabase.from('agent_status').select('agent_name, status')
        : Promise.resolve({ data: [] as { agent_name: string; status: string }[], error: null }),
      supabase.rpc('analytics_daily_completions', {
        p_since: sevenDaysAgo,
        ...rpcParams,
      }),
      supabase.rpc('analytics_cost_sum', {
        p_since: sevenDaysAgo,
        ...rpcParams,
      }),
      supabase.rpc('analytics_cost_sum', {
        p_since: fourteenDaysAgo,
        p_until: sevenDaysAgo,
        ...rpcParams,
      }),
      supabase.rpc('analytics_daily_cost', {
        p_since: sevenDaysAgo,
        ...rpcParams,
      }),
      q8,
      q9,
      q10,
    ]);
    const agentStatuses = agentStatusResult.data;

    if (dcErr) throw dcErr;
    if (ctErr) throw ctErr;
    if (clErr) throw clErr;
    if (dCostErr) throw dCostErr;

    // Build daily completion sparkline from RPC results
    const completionsByDay = new Map<string, number>();
    for (const row of (dailyCompletions as Array<{ day: string; count: number }>) ?? []) {
      completionsByDay.set(row.day, Number(row.count));
    }
    const sparkline: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
      sparkline.push(completionsByDay.get(key) ?? 0);
    }

    const totalAgents = (agentStatuses ?? []).length;
    const activeAgents = (agentStatuses ?? []).filter(
      (a) => a.status === 'working' || a.status === 'online',
    ).length;

    // Cost sums from RPCs (single-row results)
    const costThisRow = Array.isArray(costThisWeekData) ? costThisWeekData[0] : costThisWeekData;
    const costPrevRow = Array.isArray(costLastWeekData) ? costLastWeekData[0] : costLastWeekData;
    const costThis = Number(costThisRow?.total_cost ?? 0);
    const costPrev = Number(costPrevRow?.total_cost ?? 0);

    // Build daily cost sparkline from RPC results
    const costsByDay = new Map<string, number>();
    for (const row of (dailyCosts as Array<{ day: string; total_cost: number }>) ?? []) {
      costsByDay.set(row.day, Number(row.total_cost));
    }
    const costSparkline: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      costSparkline.push(Math.round((costsByDay.get(key) ?? 0) * 100) / 100);
    }

    const errorRate =
      totalEvents && totalEvents > 0
        ? Math.round(((errorCount ?? 0) / totalEvents) * 1000) / 10
        : 0;

    // Avg completion time (still needs row-level processing for metadata->claimed_at)
    let totalHours = 0;
    let countWithTime = 0;
    for (const t of completedTasks ?? []) {
      const row = t as Record<string, unknown>;
      const claimedAt = row.claimed_at as string | undefined;
      const updatedAt = row.updated_at as string | undefined;
      if (claimedAt && updatedAt) {
        const hours =
          (new Date(updatedAt).getTime() - new Date(claimedAt).getTime()) / (1000 * 60 * 60);
        if (hours > 0 && hours < 720) {
          totalHours += hours;
          countWithTime++;
        }
      }
    }
    const avgCompletionHours =
      countWithTime > 0 ? Math.round((totalHours / countWithTime) * 10) / 10 : null;

    // Compute deltas
    const tasksDelta =
      completedLastWeek && completedLastWeek > 0
        ? Math.round((((completedThisWeek ?? 0) - completedLastWeek) / completedLastWeek) * 100)
        : null;

    const costDelta = costPrev > 0 ? Math.round(((costThis - costPrev) / costPrev) * 100) : null;

    return cachedJson({
      tasksCompleted: completedThisWeek ?? 0,
      tasksDelta,
      tasksSparkline: sparkline,
      avgCompletionHours,
      activeAgents,
      totalAgents,
      totalCost: Math.round(costThis * 100) / 100,
      costDelta,
      costSparkline,
      errorRate,
      errorCount: errorCount ?? 0,
      totalEvents: totalEvents ?? 0,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
