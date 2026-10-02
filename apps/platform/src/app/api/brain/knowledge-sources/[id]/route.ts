/**
 * Knowledge Source item endpoint.
 *
 * GET    /api/brain/knowledge-sources/[id]?workspace_id=<id>
 * PATCH  /api/brain/knowledge-sources/[id]  { name?, crawl_config?, is_active? }
 * DELETE /api/brain/knowledge-sources/[id]?workspace_id=<id>
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

const patchSchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().max(200).optional(),
  crawl_config: z
    .object({
      max_pages: z.number().int().min(1).max(500).optional(),
      include_patterns: z.array(z.string().max(200)).max(20).optional(),
      exclude_patterns: z.array(z.string().max(200)).max(20).optional(),
    })
    .optional(),
  is_active: z.boolean().optional(),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitGet = await applyRateLimit(request, 'brain.knowledge-sources.get', RATE_READ);
  if (rateLimitGet) return rateLimitGet.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid knowledge source ID' }, { status: 400 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId || !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Valid workspace_id is required' }, { status: 400 });
    }

    const forbidden = await requireWorkspaceMembership(userId, workspaceId);
    if (forbidden) return forbidden;

    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('knowledge_sources')
      .select(
        'id, workspace_id, source_type, url, name, status, crawl_config, last_crawled_at, last_error, pages_crawled, chunks_created, is_active, created_by, created_at, updated_at',
      )
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Knowledge source not found' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originError = await validateOrigin(request);
  if (originError) return originError;
  const rateLimitResult = await applyRateLimit(
    request,
    'brain.knowledge-sources.update',
    RATE_WRITE,
  );
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid knowledge source ID' }, { status: 400 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = patchSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join('; ');
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const { workspace_id, name, crawl_config, is_active } = parsed.data;

    const forbidden = await requireWorkspaceMembership(userId, workspace_id);
    if (forbidden) return forbidden;

    const supabase = createServiceClient();

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) update.name = name;
    if (crawl_config !== undefined) update.crawl_config = crawl_config;
    if (is_active !== undefined) update.is_active = is_active;

    const { data, error } = await supabase
      .from('knowledge_sources')
      .update(update)
      .eq('id', id)
      .eq('workspace_id', workspace_id)
      .select('id, source_type, url, name, status, crawl_config, is_active, updated_at')
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Knowledge source not found' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = await validateOrigin(request);
  if (originError) return originError;
  const rateLimitResult = await applyRateLimit(
    request,
    'brain.knowledge-sources.delete',
    RATE_WRITE,
  );
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid knowledge source ID' }, { status: 400 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId || !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Valid workspace_id is required' }, { status: 400 });
    }

    const forbidden = await requireWorkspaceMembership(userId, workspaceId);
    if (forbidden) return forbidden;

    const supabase = createServiceClient();

    // Also clean up any chunks in agent_memory sourced from this knowledge source
    await supabase
      .from('agent_memory')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('source', `crawl:${id}`);

    const { error } = await supabase
      .from('knowledge_sources')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspaceId);

    if (error) {
      console.error('[knowledge-sources] Delete error:', error);
      return NextResponse.json({ error: 'Failed to delete knowledge source' }, { status: 500 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
