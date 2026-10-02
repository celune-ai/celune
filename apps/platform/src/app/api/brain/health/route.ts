/**
 * Brain health check endpoint — config drift detection.
 *
 * GET /api/brain/health?workspace_id=<id>
 *
 * Analyzes workspace brain manifest for drift: forked files, stale configs,
 * orphaned references, missing core components. Returns a drift score,
 * status (healthy/drifting/degraded), and individual findings.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { safeErrorResponse } from '@/lib/api-error';
import { analyzeDrift } from '@repo/db/config-drift';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const rl = await applyRateLimit(request, 'brain.health', RATE_READ);
  if (rl) return rl.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json(
        { error: 'workspace_id query parameter is required' },
        { status: 400 },
      );
    }
    if (!isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }

    const forbidden = await requireWorkspaceMembership(userId, workspaceId);
    if (forbidden) return forbidden;

    // Service client: reads brain_manifest for drift analysis. Accesses: brain_manifest.
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('brain_manifest')
      .select('path, is_core, is_forked, update_available, ownership_scope, updated_at')
      .eq('workspace_id', workspaceId)
      .limit(500);

    if (error) {
      console.error('[brain-health] Query error:', error);
      return NextResponse.json({ error: 'Failed to load manifest' }, { status: 500 });
    }

    const report = analyzeDrift(workspaceId, data ?? []);

    return NextResponse.json(report);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
