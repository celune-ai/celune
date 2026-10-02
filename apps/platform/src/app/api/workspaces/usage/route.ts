import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { cachedJson } from '@/lib/api-cache';
import { resolveWorkspacePlan } from '@/lib/plan-enforcement';
import { extractRequiredWorkspaceId } from '@/lib/require-workspace';
import { getAuthUserId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface UsageMetric {
  key: string;
  label: string;
  used: number;
  limit: number | null;
  percentage: number | null;
}

/**
 * GET /api/workspaces/usage?workspace_id=xxx
 * Returns current usage vs plan limits for all tracked metrics.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    const { plan, limits, isPlatformOwner } = await resolveWorkspacePlan(
      workspaceId,
      userId ?? undefined,
    );

    const supabase = createServiceClient();

    // Gather usage counts
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const since = monthStart.toISOString();

    const [usageEvents, agentResult, memoryResult] = await Promise.all([
      supabase.rpc('sum_usage_events', {
        p_workspace_id: workspaceId,
        p_since: since,
      }),
      supabase
        .from('agent_configs')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('agent_type', 'ai'),
      supabase
        .from('agent_memory')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId),
    ]);

    const eventCounts: Record<string, number> = {};
    for (const e of (usageEvents.data ?? []) as { event_type: string; total: number }[]) {
      eventCounts[e.event_type] = e.total;
    }

    const usage = {
      agents: agentResult.count ?? 0,
      tasks: eventCounts['task_executed'] ?? 0,
      tts_minutes: eventCounts['tts_minutes'] ?? 0,
      api_calls: eventCounts['api_call'] ?? 0,
      memories: memoryResult.count ?? 0,
    };

    function pct(used: number, limit: number | null): number | null {
      if (limit === null) return null;
      if (limit === 0) return used > 0 ? 100 : 0;
      return Math.min(100, Math.round((used / limit) * 100));
    }

    const metrics: UsageMetric[] = [
      {
        key: 'agents',
        label: 'Agents',
        used: usage.agents,
        limit: limits.max_agents,
        percentage: pct(usage.agents, limits.max_agents),
      },
      {
        key: 'tasks',
        label: 'Tasks this month',
        used: usage.tasks,
        limit: limits.max_tasks_per_month,
        percentage: pct(usage.tasks, limits.max_tasks_per_month),
      },
      {
        key: 'memories',
        label: 'Memory entries',
        used: usage.memories,
        limit: limits.max_memories,
        percentage: pct(usage.memories, limits.max_memories),
      },
      {
        key: 'tts_minutes',
        label: 'TTS minutes',
        used: usage.tts_minutes,
        limit: limits.max_tts_minutes_per_month,
        percentage: pct(usage.tts_minutes, limits.max_tts_minutes_per_month),
      },
      {
        key: 'api_calls',
        label: 'API calls',
        used: usage.api_calls,
        limit: limits.max_api_calls_per_month,
        percentage: pct(usage.api_calls, limits.max_api_calls_per_month),
      },
    ];

    const hasWarning = metrics.some((m) => m.percentage !== null && m.percentage >= 80);

    return cachedJson(
      {
        plan,
        is_platform_owner: isPlatformOwner,
        limits,
        usage,
        metrics,
        has_warning: hasWarning,
      },
      60,
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
