import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { extractRequiredWorkspaceId, requireWorkspaceMembership } from '@/lib/require-workspace';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

/**
 * GET /api/memory/stats?workspace_id=...
 *
 * Returns rich memory statistics for the AI insights panel:
 * - Total count
 * - Per-agent counts
 * - Per-category counts
 * - Per-source counts
 * - Recent activity (last 7 and 30 days)
 * - Oldest and newest memory dates
 */
export async function GET(request: NextRequest) {
  const rl = await applyRateLimit(request, 'memory.stats', RATE_READ);
  if (rl) return rl.blocked;

  try {
    // 1. Authenticate via Supabase session (JWT-verified)
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = user.id;

    // 2. Extract and validate workspace_id
    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    // 3. Check workspace membership
    const forbidden = await requireWorkspaceMembership(userId, workspaceId);
    if (forbidden) return forbidden;

    // 4. Fetch all memory rows (lightweight columns only) for aggregation
    const supabase = createServiceClient();
    const { data: memories, error } = await supabase
      .from('agent_memory')
      .select('agent_id, category, source, created_at, is_archived')
      .eq('workspace_id', workspaceId);

    if (error) throw error;

    const rows = memories ?? [];
    const total = rows.length;

    // 5. Aggregate in-memory
    const agentCounts: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};
    const sourceCounts: Record<string, number> = {};
    let oldestMemory: string | null = null;
    let newestMemory: string | null = null;

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    let last7Days = 0;
    let last30Days = 0;
    let archivedCount = 0;

    for (const row of rows) {
      if (row.is_archived) archivedCount++;
      // Per-agent
      const agentKey = row.agent_id ?? '__none__';
      agentCounts[agentKey] = (agentCounts[agentKey] ?? 0) + 1;

      // Per-category
      if (row.category) {
        categoryCounts[row.category] = (categoryCounts[row.category] ?? 0) + 1;
      }

      // Per-source
      if (row.source) {
        sourceCounts[row.source] = (sourceCounts[row.source] ?? 0) + 1;
      }

      // Date tracking
      const createdAt = row.created_at;
      if (createdAt) {
        if (!oldestMemory || createdAt < oldestMemory) oldestMemory = createdAt;
        if (!newestMemory || createdAt > newestMemory) newestMemory = createdAt;

        const ts = new Date(createdAt).getTime();
        if (ts >= sevenDaysAgo) last7Days++;
        if (ts >= thirtyDaysAgo) last30Days++;
      }
    }

    // 6. Shape response
    const byAgent = Object.entries(agentCounts).map(([agent_id, count]) => ({
      agent_id: agent_id === '__none__' ? null : agent_id,
      count,
    }));

    const byCategory = Object.entries(categoryCounts).map(([category, count]) => ({
      category,
      count,
    }));

    const bySource = Object.entries(sourceCounts).map(([source, count]) => ({
      source,
      count,
    }));

    const response = NextResponse.json({
      total,
      archived: archivedCount,
      active: total - archivedCount,
      byAgent,
      byCategory,
      bySource,
      recentActivity: {
        last7Days,
        last30Days,
      },
      oldestMemory,
      newestMemory,
    });

    response.headers.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=15');

    return response;
  } catch (error) {
    return safeErrorResponse(error);
  }
}
