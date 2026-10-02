import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

/**
 * GET /api/memory/graph?workspace_id=<uuid>[&seed=<id>&depth=<n>&limit=200]
 *
 * Two modes:
 * 1. Seed mode: seed=<uuid> — BFS from a specific memory (original behavior)
 * 2. Full mode: no seed — returns all memories as nodes + all relations as edges
 */
export async function GET(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'memory.graph', RATE_READ);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const searchParams = request.nextUrl.searchParams;
    const seed = searchParams.get('seed');
    const depth = Math.min(Math.max(1, Number(searchParams.get('depth') ?? 2)), 5);
    const workspaceId = searchParams.get('workspace_id');
    const limit = Math.min(Math.max(1, Number(searchParams.get('limit') ?? 200)), 500);

    if (!workspaceId || !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const membershipError = await requireWorkspaceMembership(user.id, workspaceId);
    if (membershipError) return membershipError;

    // Seed mode — BFS from a single memory
    if (seed) {
      if (!isValidUuid(seed)) {
        return NextResponse.json({ error: 'seed must be a valid UUID' }, { status: 400 });
      }
      const { data, error } = await supabase.rpc('get_memory_graph', {
        p_memory_id: seed,
        p_depth: depth,
        p_workspace_id: workspaceId,
      });
      if (error) throw error;
      return NextResponse.json(data ?? { nodes: [], edges: [] });
    }

    // Full mode — return all memories and their relations
    const { data: memories, error: memError } = await supabase
      .from('agent_memory')
      .select('id, key, category, importance_score')
      .eq('workspace_id', workspaceId)
      .order('importance_score', { ascending: false })
      .limit(limit);

    if (memError) throw memError;

    const memoryIds = (memories ?? []).map((m) => m.id);
    let edges: Array<{
      source: string;
      target: string;
      relation_type: string;
      confidence: number;
      is_auto_detected?: boolean;
    }> = [];

    if (memoryIds.length > 0) {
      const { data: relations, error: relError } = await supabase
        .from('memory_relations')
        .select('memory_id, related_id, relation_type, confidence, is_auto_detected')
        .eq('related_type', 'memory')
        .in('memory_id', memoryIds);

      if (relError) throw relError;

      const idSet = new Set(memoryIds);
      edges = (relations ?? [])
        .filter((r) => idSet.has(r.memory_id) && idSet.has(r.related_id))
        .map((r) => ({
          source: r.memory_id,
          target: r.related_id,
          relation_type: r.relation_type,
          confidence: r.confidence ?? 1,
          is_auto_detected: r.is_auto_detected ?? false,
        }));
    }

    const nodes = (memories ?? []).map((m) => ({
      id: m.id,
      key: m.key ?? '',
      category: m.category ?? 'general',
      importance_score: m.importance_score ?? 0.5,
    }));

    return NextResponse.json({ nodes, edges });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
