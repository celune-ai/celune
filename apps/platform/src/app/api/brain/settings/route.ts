/**
 * Brain Settings endpoint.
 *
 * GET   /api/brain/settings?workspace_id=<id>
 * PATCH /api/brain/settings  { workspace_id, ...settings }
 *
 * Reads and updates the brain_settings JSONB column on the workspaces table.
 * Controls hybrid search behavior, weights, embedding model, reranking, and crawl interval.
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

const DEFAULTS = {
  hybrid_search: true,
  vector_weight: 0.7,
  keyword_weight: 0.3,
  reranking: false,
  embedding_model: 'gte-small',
  auto_crawl_interval_hours: 24,
};

const patchSchema = z.object({
  workspace_id: z.string().uuid(),
  hybrid_search: z.boolean().optional(),
  vector_weight: z.number().min(0).max(1).optional(),
  keyword_weight: z.number().min(0).max(1).optional(),
  reranking: z.boolean().optional(),
  embedding_model: z.enum(['gte-small']).optional(),
  auto_crawl_interval_hours: z.number().int().min(1).max(168).optional(),
});

export async function GET(request: NextRequest) {
  const rateLimitGet = await applyRateLimit(request, 'brain.settings.get', RATE_READ);
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

    const { data, error } = await supabase
      .from('workspaces')
      .select('brain_settings')
      .eq('id', workspaceId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    // Merge with defaults so clients always see every key
    const settings = { ...DEFAULTS, ...((data.brain_settings as Record<string, unknown>) ?? {}) };

    return NextResponse.json({ data: settings });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;
  const rateLimitResult = await applyRateLimit(request, 'brain.settings.update', RATE_WRITE);
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

    const parsed = patchSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join('; ');
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const { workspace_id, ...updates } = parsed.data;

    // Validate weights sum to ~1.0 if both provided
    if (updates.vector_weight !== undefined && updates.keyword_weight !== undefined) {
      const sum = updates.vector_weight + updates.keyword_weight;
      if (Math.abs(sum - 1.0) > 0.01) {
        return NextResponse.json(
          { error: 'vector_weight + keyword_weight must equal 1.0' },
          { status: 400 },
        );
      }
    }

    const forbidden = await requireWorkspaceMembership(userId, workspace_id);
    if (forbidden) return forbidden;

    const supabase = createServiceClient();

    // Read current settings
    const { data: ws } = await supabase
      .from('workspaces')
      .select('brain_settings')
      .eq('id', workspace_id)
      .single();

    const current = (ws?.brain_settings as Record<string, unknown>) ?? {};
    const merged = { ...DEFAULTS, ...current, ...updates };

    const { error } = await supabase
      .from('workspaces')
      .update({ brain_settings: merged })
      .eq('id', workspace_id);

    if (error) {
      console.error('[brain-settings] Update error:', error);
      return NextResponse.json({ error: 'Failed to update brain settings' }, { status: 500 });
    }

    return NextResponse.json({ data: merged });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
