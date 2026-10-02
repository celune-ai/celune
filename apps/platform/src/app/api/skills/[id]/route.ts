/**
 * Individual skill endpoint.
 *
 * GET    /api/skills/:id?workspace_id=<id>
 * PATCH  /api/skills/:id  { workspace_id, is_enabled?, description?, tags? }
 * DELETE /api/skills/:id  { workspace_id }
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const updateSkillSchema = z.object({
  workspace_id: z.string().uuid(),
  is_enabled: z.boolean().optional(),
  description: z.string().max(500).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
});

const deleteSkillSchema = z.object({
  workspace_id: z.string().uuid(),
});

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id } = await context.params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid skill ID' }, { status: 400 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId || !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Valid workspace_id is required' }, { status: 400 });
    }

    const forbidden = await requireWorkspaceMembership(userId, workspaceId);
    if (forbidden) return forbidden;

    // Service client: reads a single brain_manifest entry. Accesses: brain_manifest.
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('brain_manifest')
      .select(
        'id, workspace_id, path, content_hash, version, tier, category, description, tags, skill_pack_id, install_source, is_core, is_forked, is_enabled, ownership_scope, update_available, update_summary, created_at, updated_at',
      )
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const originError = await validateOrigin(request);
  if (originError) return originError;
  const rateLimitResult = await applyRateLimit(request, 'skills.update', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id } = await context.params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid skill ID' }, { status: 400 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = updateSkillSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join('; ');
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const { workspace_id, ...updates } = parsed.data;

    const forbidden = await requireWorkspaceMembership(userId, workspace_id);
    if (forbidden) return forbidden;

    // Service client: updates a brain_manifest entry. Accesses: brain_manifest.
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('brain_manifest')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('workspace_id', workspace_id)
      .select('id, path, category, tier, description, tags, is_enabled, updated_at')
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Skill not found or update failed' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const originError = await validateOrigin(request);
  if (originError) return originError;
  const rateLimitResult = await applyRateLimit(request, 'skills.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id } = await context.params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid skill ID' }, { status: 400 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = deleteSkillSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }

    const { workspace_id } = parsed.data;

    const forbidden = await requireWorkspaceMembership(userId, workspace_id);
    if (forbidden) return forbidden;

    // Service client: deletes a brain_manifest entry. Accesses: brain_manifest.
    const supabase = createServiceClient();

    // Prevent deletion of core skills
    const { data: existing } = await supabase
      .from('brain_manifest')
      .select('is_core, install_source')
      .eq('id', id)
      .eq('workspace_id', workspace_id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }

    if (existing.is_core) {
      return NextResponse.json(
        { error: 'Cannot delete core skills. Disable them instead.' },
        { status: 403 },
      );
    }

    const { error } = await supabase
      .from('brain_manifest')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspace_id);

    if (error) {
      console.error('[skills] Delete error:', error);
      return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
