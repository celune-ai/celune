import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveWorkspacePlan, getCurrentUsage } from '@/lib/plan-enforcement';
import { extractRequiredWorkspaceId, requireWorkspaceMembership } from '@/lib/require-workspace';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * GET /api/workspaces/usage-status?workspace_id=xxx
 *
 * Returns whether the workspace is currently over any plan limits.
 * Used by the DowngradeBanner to detect post-downgrade limit overages.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    const forbidden = await requireWorkspaceMembership(userId, workspaceId);
    if (forbidden) return forbidden;

    const { limits, isPlatformOwner } = await resolveWorkspacePlan(workspaceId, userId);

    // Platform owners have no limits
    if (isPlatformOwner) {
      return NextResponse.json({ over_limit: false, details: [] });
    }

    const usage = await getCurrentUsage(workspaceId);

    const checks: { resource: string; current: number; limit: number | null }[] = [
      { resource: 'agents', current: usage.agent_count, limit: limits.max_agents },
      { resource: 'tasks', current: usage.tasks_this_month, limit: limits.max_tasks_per_month },
      {
        resource: 'tts_minutes',
        current: usage.tts_minutes_this_month,
        limit: limits.max_tts_minutes_per_month,
      },
      {
        resource: 'api_calls',
        current: usage.api_calls_this_month,
        limit: limits.max_api_calls_per_month,
      },
    ];

    const overages = checks
      .filter((c) => c.limit !== null && c.current > c.limit)
      .map((c) => ({ resource: c.resource, current: c.current, limit: c.limit! }));

    return NextResponse.json({
      over_limit: overages.length > 0,
      details: overages,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
