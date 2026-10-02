import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { extractRequiredWorkspaceId, requireWorkspaceMembership } from '@/lib/require-workspace';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';
import { validateOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

const STALE_DAYS = 60;
const LOW_IMPORTANCE_THRESHOLD = 0.3;

interface HealthCheck {
  name: string;
  count: number;
  penalty: number;
  items: { id: string; key: string; reason: string }[];
}

/**
 * GET /api/memory/health?workspace_id=...
 *
 * Runs quality checks against agent_memory and returns a 0-100 health score
 * with actionable recommendations.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const originError = await validateOrigin(request);
  if (originError) return originError;

  const rl = await applyRateLimit(request, 'memory.health', RATE_READ);
  if (rl) return rl.blocked;

  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = user.id;

    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    const forbidden = await requireWorkspaceMembership(userId, workspaceId);
    if (forbidden) return forbidden;

    const supabase = createServiceClient();

    // Fetch memories without content (not needed for health checks, saves bandwidth)
    const { data: memories, error } = await supabase
      .from('agent_memory')
      .select(
        'id, key, category, importance_score, access_count, last_accessed_at, created_at, is_archived',
      )
      .eq('workspace_id', workspaceId)
      .eq('is_archived', false);

    if (error) throw error;

    const rows = memories ?? [];
    const total = rows.length;

    if (total === 0) {
      return NextResponse.json({
        score: 100,
        total: 0,
        checks: [],
        topActions: [],
      });
    }

    const checks: HealthCheck[] = [];
    const now = Date.now();
    const staleCutoff = now - STALE_DAYS * 24 * 60 * 60 * 1000;

    // 1. Stale memories — not accessed in 60+ days
    const staleItems = rows
      .filter((r) => {
        const lastAccess = r.last_accessed_at
          ? new Date(r.last_accessed_at).getTime()
          : new Date(r.created_at).getTime();
        return lastAccess < staleCutoff;
      })
      .map((r) => {
        const lastAccess = r.last_accessed_at ?? r.created_at;
        const daysAgo = Math.floor((now - new Date(lastAccess).getTime()) / (24 * 60 * 60 * 1000));
        return { id: r.id, key: r.key, reason: `Not accessed in ${daysAgo} days` };
      });

    checks.push({
      name: 'Stale Memories',
      count: staleItems.length,
      penalty: 2,
      items: staleItems.slice(0, 10),
    });

    // 2. Low-importance clutter — importance < 0.3 and never accessed
    const clutterItems = rows
      .filter(
        (r) => (r.importance_score ?? 0) < LOW_IMPORTANCE_THRESHOLD && (r.access_count ?? 0) === 0,
      )
      .map((r) => ({
        id: r.id,
        key: r.key,
        reason: `Low importance (${r.importance_score}), never accessed`,
      }));

    checks.push({
      name: 'Low-Importance Clutter',
      count: clutterItems.length,
      penalty: 1,
      items: clutterItems.slice(0, 10),
    });

    // 3. Category imbalance — too many "general" memories
    const generalCount = rows.filter((r) => r.category === 'general').length;
    const generalRatio = total > 0 ? generalCount / total : 0;
    const imbalanceItems =
      generalRatio > 0.5
        ? [
            {
              id: '',
              key: 'category-imbalance',
              reason: `${Math.round(generalRatio * 100)}% of memories are "general" (aim for < 50%)`,
            },
          ]
        : [];

    checks.push({
      name: 'Category Imbalance',
      count: imbalanceItems.length > 0 ? generalCount : 0,
      penalty: imbalanceItems.length > 0 ? 5 : 0,
      items: imbalanceItems,
    });

    // 4. Orphan memories — batch both directions in a single parallel fetch
    const memoryIds = rows.map((r) => r.id);
    const [{ data: forwardRels }, { data: reverseRels }] = await Promise.all([
      supabase.from('memory_relations').select('memory_id').in('memory_id', memoryIds),
      supabase
        .from('memory_relations')
        .select('related_id')
        .eq('related_type', 'memory')
        .in('related_id', memoryIds),
    ]);

    const connectedSet = new Set<string>();
    for (const r of forwardRels ?? []) connectedSet.add(r.memory_id);
    for (const r of reverseRels ?? []) connectedSet.add(r.related_id);

    const orphanItems = rows
      .filter((r) => !connectedSet.has(r.id))
      .map((r) => ({ id: r.id, key: r.key, reason: 'No relations to other memories' }));

    checks.push({
      name: 'Orphan Memories',
      count: orphanItems.length,
      penalty: 1,
      items: orphanItems.slice(0, 10),
    });

    // 5. Contradictions — use existing RPC
    let contradictionCount = 0;
    try {
      const { data: contradictions } = await supabase.rpc('find_contradictions', {
        p_workspace_id: workspaceId,
        p_limit: 5,
      });
      contradictionCount = (contradictions ?? []).length;
    } catch {
      // RPC may not exist yet; skip silently
    }

    if (contradictionCount > 0) {
      checks.push({
        name: 'Contradictions',
        count: contradictionCount,
        penalty: 5,
        items: [
          {
            id: '',
            key: 'contradictions',
            reason: `${contradictionCount} contradicting memory pairs found`,
          },
        ],
      });
    }

    // Calculate score (clamp to 0-100)
    let score = 100;
    for (const check of checks) {
      const ratio = total > 0 ? check.count / total : 0;
      score -= Math.round(ratio * 100 * check.penalty);
      if (score <= 0) {
        score = 0;
        break;
      }
    }
    score = Math.min(100, score);

    // Build top 3 actionable recommendations
    const topActions = checks
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count * b.penalty - a.count * a.penalty)
      .slice(0, 3)
      .map((c) => ({
        name: c.name,
        count: c.count,
        action: getActionText(c.name, c.count),
      }));

    const response = NextResponse.json({
      score,
      total,
      checks: checks.map((c) => ({
        name: c.name,
        count: c.count,
        items: c.items,
      })),
      topActions,
    });

    response.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=30');
    return response;
  } catch (error) {
    return safeErrorResponse(error);
  }
}

function getActionText(checkName: string, count: number): string {
  switch (checkName) {
    case 'Stale Memories':
      return `Review and archive ${count} stale memories that haven't been accessed recently`;
    case 'Low-Importance Clutter':
      return `Clean up ${count} low-importance memories that were never used`;
    case 'Category Imbalance':
      return 'Re-categorize "general" memories into specific types (decision, fact, preference)';
    case 'Orphan Memories':
      return `${count} memories have no connections; consider linking or archiving them`;
    case 'Contradictions':
      return `Resolve ${count} contradicting memory pairs to improve agent accuracy`;
    default:
      return `Address ${count} issues in ${checkName}`;
  }
}
