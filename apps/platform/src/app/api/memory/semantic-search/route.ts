import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@repo/db/server';
import { createServiceClient } from '@repo/db/service';
import { searchAgentMemories } from '@repo/db/queries';
import { safeErrorResponse } from '@/lib/api-error';
import { extractRequiredWorkspaceId, requireWorkspaceMembership } from '@/lib/require-workspace';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

type DetailLevel = 'abstract' | 'overview' | 'full';

/** Generate embedding via Supabase edge function. Returns null on failure. */
async function generateEmbedding(input: string): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ input }),
    });
    if (!res.ok) return null;
    const { embeddings } = await res.json();
    return JSON.stringify(embeddings);
  } catch {
    return null;
  }
}

/** Shape results based on detail_level — strip heavy fields for lighter responses. */
function shapeResults(results: Record<string, unknown>[], detail: DetailLevel) {
  if (detail === 'full') return results;
  return results.map((r) => {
    const shaped: Record<string, unknown> = { ...r };
    if (detail === 'abstract') {
      delete shaped.content;
      delete shaped.overview;
    } else if (detail === 'overview') {
      delete shaped.content;
    }
    return shaped;
  });
}

/**
 * GET /api/memory/semantic-search?q=...&workspace_id=...&limit=...&threshold=...&detail_level=...
 * Tries semantic (vector) search first, falls back to FTS keyword search.
 *
 * detail_level: "abstract" (L0 only), "overview" (L0+L1), "full" (default, all fields)
 */
export async function GET(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'memory.semantic-search.get', RATE_READ);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspace_id = wsResult;

    // Verify workspace membership (defense-in-depth alongside RLS)
    const membershipError = await requireWorkspaceMembership(user.id, workspace_id);
    if (membershipError) return membershipError;

    const searchParams = request.nextUrl.searchParams;
    const q = searchParams.get('q');
    const limit = Math.min(Number(searchParams.get('limit') ?? '20'), 50);
    const threshold = Number(searchParams.get('threshold') ?? '0.4');
    const detail = (searchParams.get('detail_level') ?? 'full') as DetailLevel;

    if (!q) {
      return NextResponse.json({ error: 'Missing required query parameter: q' }, { status: 400 });
    }
    if (q.length > 500) {
      return NextResponse.json({ error: 'Query must be 500 characters or fewer' }, { status: 400 });
    }

    // Try semantic search if embedding infrastructure is available
    const embedding = await generateEmbedding(q);
    if (embedding) {
      // Service client: match_memories is not executable by user roles; membership is checked above. Accesses: agent_memory via match_memories.
      const { data, error } = await createServiceClient().rpc('match_memories', {
        query_embedding: embedding,
        match_threshold: threshold,
        match_count: limit,
        filter_user_id: user.id,
        filter_org_id: null,
        filter_workspace_id: workspace_id,
      });

      if (!error && data) {
        return NextResponse.json({
          results: shapeResults(data as Record<string, unknown>[], detail),
          mode: 'semantic',
        });
      }
    }

    // Fallback: FTS keyword search via tsvector
    const results = await searchAgentMemories(supabase, {
      workspace_id,
      query: q,
      limit,
    });

    return NextResponse.json({
      results: shapeResults(results as unknown as Record<string, unknown>[], detail),
      mode: 'keyword',
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
