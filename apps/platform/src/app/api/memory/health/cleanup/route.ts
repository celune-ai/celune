import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { extractRequiredWorkspaceId, requireWorkspaceMembership } from '@/lib/require-workspace';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { validateOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

const STALE_DAYS = 60;
const LOW_IMPORTANCE_THRESHOLD = 0.3;

/**
 * POST /api/memory/health/cleanup?workspace_id=...
 *
 * Archives stale and low-importance memories in a single atomic query
 * to prevent double-counting race conditions.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const originError = await validateOrigin(request);
  if (originError) return originError;

  const rl = await applyRateLimit(request, 'memory.health.cleanup', RATE_WRITE);
  if (rl) return rl.blocked;

  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    const forbidden = await requireWorkspaceMembership(user.id, workspaceId);
    if (forbidden) return forbidden;

    const supabase = createServiceClient();
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Single atomic query: archive memories that are stale OR low-importance clutter.
    // This prevents the race condition where two separate UPDATEs could double-count
    // a memory that matches both conditions.
    const { data: archived } = await supabase.rpc('archive_unhealthy_memories', {
      p_workspace_id: workspaceId,
      p_stale_cutoff: staleCutoff,
      p_importance_threshold: LOW_IMPORTANCE_THRESHOLD,
    });

    // Fallback if the RPC doesn't exist yet: run sequentially with exclusion
    if (archived === null) {
      // First pass: stale memories
      const { count: staleCount } = await supabase
        .from('agent_memory')
        .update({ is_archived: true })
        .eq('workspace_id', workspaceId)
        .eq('is_archived', false)
        .eq('is_core', false)
        .lt('last_accessed_at', staleCutoff)
        .not('last_accessed_at', 'is', null);

      // Second pass: low-importance clutter, excluding already-archived stale ones
      const { count: clutterCount } = await supabase
        .from('agent_memory')
        .update({ is_archived: true })
        .eq('workspace_id', workspaceId)
        .eq('is_archived', false)
        .eq('is_core', false)
        .eq('access_count', 0)
        .lt('importance_score', LOW_IMPORTANCE_THRESHOLD);

      return NextResponse.json({
        archived: {
          stale: staleCount ?? 0,
          clutter: clutterCount ?? 0,
          total: (staleCount ?? 0) + (clutterCount ?? 0),
        },
      });
    }

    const result = archived as { stale: number; clutter: number; total: number };
    return NextResponse.json({ archived: result });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
