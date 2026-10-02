import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { searchAgentMemories } from '@repo/db/queries';
import type { MemoryCategory } from '@repo/types';
import { safeErrorResponse } from '@/lib/api-error';
import { extractRequiredWorkspaceId, requireWorkspaceMembership } from '@/lib/require-workspace';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

/**
 * GET /api/memory/search?q=...&workspace_id=...&category=...&limit=...
 * Full-text search across workspace memories using Postgres tsvector.
 * Replaces the old brain.sqlite FTS5 search.
 */
export async function GET(request: NextRequest) {
  const rl = await applyRateLimit(request, 'memory.search', RATE_READ);
  if (rl) return rl.blocked;

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
    const category = searchParams.get('category') as MemoryCategory | null;
    const tagsParam = searchParams.get('tags');
    const tags = tagsParam
      ? tagsParam
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined;
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10) || 20, 50);

    if (!q) {
      return NextResponse.json({ error: 'Missing required query parameter: q' }, { status: 400 });
    }
    if (q.length > 500) {
      return NextResponse.json({ error: 'Query must be 500 characters or fewer' }, { status: 400 });
    }

    const results = await searchAgentMemories(supabase, {
      workspace_id,
      query: q,
      category: category ?? undefined,
      tags,
      limit,
    });

    return NextResponse.json({
      query: q,
      count: results.length,
      results,
      mode: 'keyword',
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
