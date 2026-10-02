import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { extractRequiredWorkspaceId, requireWorkspaceMembership } from '@/lib/require-workspace';
import { getAuthUserId } from '@/lib/auth';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

const SearchBodySchema = z.object({
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(50).optional().default(10),
  source_ids: z.array(z.string().uuid()).optional(),
});

export const dynamic = 'force-dynamic';

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

/**
 * POST /api/knowledge/search?workspace_id=...
 * Semantic search across all workspace knowledge items via pgvector cosine similarity.
 * Body: { query: string, limit?: number, source_ids?: string[] }
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'knowledge.search.post', RATE_READ);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    const membershipError = await requireWorkspaceMembership(userId, workspaceId);
    if (membershipError) return membershipError;

    const rawBody = await request.json();
    const parseResult = SearchBodySchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0]?.message ?? 'Invalid request body' },
        { status: 400 },
      );
    }
    const { query, limit, source_ids } = parseResult.data;

    // Generate embedding for the query
    const embedding = await generateEmbedding(query);
    if (!embedding) {
      return NextResponse.json({ error: 'Embedding generation unavailable' }, { status: 503 });
    }

    const supabase = createServiceClient();

    // Use RPC function for vector search via pgvector cosine similarity
    const { data: results, error } = await supabase.rpc('search_knowledge_items', {
      p_workspace_id: workspaceId,
      p_embedding: embedding,
      p_limit: limit,
      p_source_ids: source_ids ?? null,
    });

    if (error) {
      // Fallback: if the RPC doesn't exist yet, return a helpful error
      if (error.message?.includes('function') && error.message?.includes('does not exist')) {
        return NextResponse.json(
          { error: 'Knowledge search RPC not yet deployed. Run the knowledge migration first.' },
          { status: 501 },
        );
      }
      throw error;
    }

    return NextResponse.json({
      results: results ?? [],
      query,
      count: results?.length ?? 0,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
