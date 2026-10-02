/**
 * Vault Publish endpoint — list and promote vault-synced content to product brain.
 *
 * GET  /api/brain/vault-publish?workspace_id=<id>  — list publishable vault memories
 * POST /api/brain/vault-publish  { workspace_id, memory_ids }  — mark memories as published
 *
 * Two-stage flow: vault → workspace agent_memory (private) → publish → product brain (shared).
 * Publishing marks memories with metadata.published=true and metadata.published_at timestamp.
 * The /brain-publish skill reads these flags to determine what to sync to the product brain.
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

const publishSchema = z.object({
  workspace_id: z.string().uuid(),
  memory_ids: z.array(z.string().uuid()).min(1).max(100),
});

export async function GET(request: NextRequest) {
  const rateLimitGet = await applyRateLimit(request, 'brain.vault-publish.list', RATE_READ);
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

    const supabase = createServiceClient();

    // Pagination params
    const limitParam = request.nextUrl.searchParams.get('limit');
    const offsetParam = request.nextUrl.searchParams.get('offset');
    const limit = Math.min(Math.max(parseInt(limitParam ?? '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(offsetParam ?? '0', 10) || 0, 0);

    // List vault-synced memories — exclude daily plans and personal categories
    const { data, error, count } = await supabase
      .from('agent_memory')
      .select('id, key, content, category, tags, metadata, created_at', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .eq('source', 'vault-sync')
      .eq('is_archived', false)
      .not('category', 'in', '("daily-plan","personal","inbox","archive")')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[vault-publish] Query error:', error);
      return NextResponse.json({ error: 'Failed to load publishable content' }, { status: 500 });
    }

    // Split into published and unpublished
    const published = (data ?? []).filter(
      (m) => (m.metadata as Record<string, unknown>)?.published === true,
    );
    const unpublished = (data ?? []).filter(
      (m) => (m.metadata as Record<string, unknown>)?.published !== true,
    );

    return NextResponse.json({
      data: {
        unpublished,
        published,
        total: count ?? 0,
        limit,
        offset,
        has_more: (count ?? 0) > offset + limit,
      },
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;
  const rateLimitResult = await applyRateLimit(request, 'brain.vault-publish.publish', RATE_WRITE);
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

    const parsed = publishSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join('; ');
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const { workspace_id, memory_ids } = parsed.data;

    const forbidden = await requireWorkspaceMembership(userId, workspace_id);
    if (forbidden) return forbidden;

    const supabase = createServiceClient();

    // Batch publish via RPC — single query for all memories
    const { data: publishedCount, error: rpcErr } = await supabase.rpc('publish_vault_memories', {
      p_memory_ids: memory_ids,
      p_workspace_id: workspace_id,
      p_user_id: userId,
    });

    if (rpcErr) {
      console.error('[vault-publish] RPC error:', rpcErr);
      return NextResponse.json({ error: 'Failed to publish memories' }, { status: 500 });
    }

    return NextResponse.json({
      data: { published: publishedCount ?? 0, total: memory_ids.length },
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
