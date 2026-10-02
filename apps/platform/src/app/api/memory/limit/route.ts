import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { safeErrorResponse } from '@/lib/api-error';
import { getMemoryUsage } from '@/lib/plan-enforcement';
import { extractRequiredWorkspaceId } from '@/lib/require-workspace';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

/**
 * GET /api/memory/limit?workspace_id=xxx
 * Returns the current memory count and plan limit for a workspace.
 * Used by the memory UI to display usage info.
 */
export async function GET(request: NextRequest) {
  const rl = await applyRateLimit(request, 'memory.limit', RATE_READ);
  if (rl) return rl.blocked;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    // Verify the authenticated user is a member of the workspace before
    // exposing plan/usage data (prevents IDOR enumeration across workspaces).
    const { data: membership } = await supabase
      .from('workspace_memberships')
      .select('workspace_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { count, limit, plan } = await getMemoryUsage(workspaceId, user.id);

    return NextResponse.json({ count, limit, plan });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
