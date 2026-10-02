import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { cachedJson } from '@/lib/api-cache';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { getAuthUserId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/[id]/budget?workspace_id=...&period=month
 *
 * Returns current-period spend vs budget cap for an agent,
 * plus cost-per-outcome (cost per completed task).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: agentId } = await params;
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId || !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }

    const membershipError = await requireWorkspaceMembership(userId, workspaceId);
    if (membershipError) return membershipError;

    const supabase = await createClient();

    // Get budget cap from agent_configs
    const { data: config } = await supabase
      .from('agent_configs')
      .select('budget_cap_usd')
      .eq('workspace_id', workspaceId)
      .eq('agent_id', agentId)
      .single();

    const budgetCap: number | null = config?.budget_cap_usd ?? null;

    // Current month boundaries
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

    // Total spend this period
    const { data: usageRows, error: usageErr } = await supabase
      .from('claude_usage')
      .select('total_cost_usd, task_id')
      .eq('workspace_id', workspaceId)
      .eq('agent_name', agentId)
      .gte('created_at', monthStart)
      .lt('created_at', monthEnd);

    if (usageErr) throw usageErr;

    const totalSpend = (usageRows || []).reduce(
      (sum, r) => sum + (Number(r.total_cost_usd) || 0),
      0,
    );

    // Cost-per-outcome: group spend by task_id, count completed tasks
    const taskCosts = new Map<string, number>();
    for (const row of usageRows || []) {
      if (row.task_id) {
        const tid = row.task_id as string;
        taskCosts.set(tid, (taskCosts.get(tid) || 0) + (Number(row.total_cost_usd) || 0));
      }
    }

    // Check which of those tasks are completed
    const taskIds = Array.from(taskCosts.keys());
    let completedCount = 0;
    let completedCost = 0;

    if (taskIds.length > 0) {
      const { data: completedTasks } = await supabase
        .from('tasks')
        .select('id')
        .in('id', taskIds)
        .eq('status', 'done');

      for (const t of completedTasks || []) {
        completedCount++;
        completedCost += taskCosts.get(t.id) || 0;
      }
    }

    const costPerOutcome =
      completedCount > 0 ? Math.round((completedCost / completedCount) * 100) / 100 : null;
    const exceeded = budgetCap !== null && totalSpend > budgetCap;
    const utilizationPct = budgetCap ? Math.round((totalSpend / budgetCap) * 100) : null;

    return cachedJson(
      {
        agent_id: agentId,
        period: 'month',
        period_start: monthStart,
        budget_cap_usd: budgetCap,
        total_spend_usd: Math.round(totalSpend * 100) / 100,
        utilization_pct: utilizationPct,
        exceeded,
        cost_per_outcome: {
          completed_tasks: completedCount,
          total_cost_usd: Math.round(completedCost * 100) / 100,
          avg_cost_per_task: costPerOutcome,
        },
      },
      60,
    );
  } catch (err) {
    return safeErrorResponse(err);
  }
}
