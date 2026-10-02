/**
 * Knowledge Sources CRUD endpoint (brain-specific access).
 *
 * GET  /api/brain/knowledge-sources?workspace_id=<id>
 * POST /api/brain/knowledge-sources  { workspace_id, source_type, url, name? }
 *
 * Manages external knowledge sources (URLs, sitemaps, GitHub repos) that feed
 * into the brain via automated crawling and chunking.
 *
 * NOTE: The canonical knowledge-sources surface is /api/knowledge/sources.
 * This /api/brain/knowledge-sources route exists for brain-specific access
 * patterns (e.g., brain sync, vault publish). Both routes share the same
 * underlying Supabase tables. Do NOT delete either route.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_READ, RATE_WRITE } from '@/lib/rate-limiter';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  workspace_id: z.string().uuid(),
  source_type: z.enum(['url', 'sitemap', 'github_repo']),
  url: z.string().url().max(2000),
  name: z.string().max(200).optional(),
  crawl_config: z
    .object({
      max_pages: z.number().int().min(1).max(500).optional(),
      include_patterns: z.array(z.string().max(200)).max(20).optional(),
      exclude_patterns: z.array(z.string().max(200)).max(20).optional(),
    })
    .optional(),
});

export async function GET(request: NextRequest) {
  const rateLimitGet = await applyRateLimit(request, 'brain.knowledge-sources.list', RATE_READ);
  if (rateLimitGet) return rateLimitGet.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId || !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Valid workspace_id is required' }, { status: 400 });
    }

    const forbidden = await requireWorkspaceMembership(userId, workspaceId);
    if (forbidden) return forbidden;

    // Service client: reads knowledge_sources for a workspace.
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('knowledge_sources')
      .select(
        'id, source_type, url, name, status, last_crawled_at, pages_crawled, chunks_created, is_active, created_at',
      )
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[knowledge-sources] Query error:', error);
      return NextResponse.json({ error: 'Failed to load knowledge sources' }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;
  const rateLimitResult = await applyRateLimit(
    request,
    'brain.knowledge-sources.create',
    RATE_WRITE,
  );
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = createSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join('; ');
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const { workspace_id, source_type, url, name, crawl_config } = parsed.data;

    const forbidden = await requireWorkspaceMembership(userId, workspace_id);
    if (forbidden) return forbidden;

    // Service client: inserts a knowledge source. Accesses: knowledge_sources.
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('knowledge_sources')
      .insert({
        workspace_id,
        source_type,
        url,
        name: name ?? null,
        crawl_config: crawl_config ?? {},
        created_by: userId,
        status: 'pending',
      })
      .select('id, source_type, url, name, status, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'This URL is already added' }, { status: 409 });
      }
      console.error('[knowledge-sources] Insert error:', error);
      return NextResponse.json({ error: 'Failed to add knowledge source' }, { status: 500 });
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
