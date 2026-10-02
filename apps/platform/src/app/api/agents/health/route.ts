import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { getAuthUserId } from '@/lib/auth';
import { extractRequiredWorkspaceId, requireWorkspaceMembership } from '@/lib/require-workspace';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

/**
 * Agent roster health check.
 * Compares DB agent_configs for the given workspace against agent_status rows.
 * workspace_id is REQUIRED — no unscoped global fallback.
 */
export async function GET(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'agents.health.get', RATE_READ);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const workspaceId = extractRequiredWorkspaceId(request);
    if (workspaceId instanceof NextResponse) return workspaceId;

    const membershipError = await requireWorkspaceMembership(userId, workspaceId);
    if (membershipError) return membershipError;

    const supabase = createServiceClient();

    // Workspace-scoped health check: compare configs vs status within workspace
    const [configResult, statusResult] = await Promise.all([
      supabase
        .from('agent_configs')
        .select('agent_id')
        .eq('workspace_id', workspaceId)
        .eq('is_active', true),
      supabase.from('agent_status').select('agent_name').eq('workspace_id', workspaceId),
    ]);

    if (configResult.error) throw configResult.error;
    if (statusResult.error) throw statusResult.error;

    const configIds = (configResult.data ?? []).map((r) => r.agent_id.toLowerCase());
    const statusIds = (statusResult.data ?? []).map((r) => r.agent_name.toLowerCase());

    const inConfigNotStatus = configIds.filter((id) => !statusIds.includes(id));
    const inStatusNotConfig = statusIds.filter((id) => !configIds.includes(id));

    const healthy = inConfigNotStatus.length === 0 && inStatusNotConfig.length === 0;

    return NextResponse.json(
      {
        healthy,
        workspaceId,
        configAgents: configIds,
        drift: {
          inConfigNotStatus,
          inStatusNotConfig,
        },
      },
      {
        headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=30' },
      },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
