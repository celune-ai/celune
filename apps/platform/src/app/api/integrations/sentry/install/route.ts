/**
 * POST /api/integrations/sentry/install
 *
 * Registers a Sentry installation for a workspace. Called after the user
 * completes Sentry's installation flow and provides the installation UUID.
 *
 * DELETE /api/integrations/sentry/install?workspace_id=xxx
 *
 * Deactivates the Sentry integration for a workspace.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const installSchema = z.object({
  workspace_id: z.string().uuid(),
  installation_uuid: z.string().min(1).max(200),
  organization_slug: z.string().max(200).optional(),
});

/**
 * POST — Register a Sentry installation for a workspace.
 */
export async function POST(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;

  const rateLimitResult = await applyRateLimit(request, 'integrations.sentry.install', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = installSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { workspace_id, installation_uuid, organization_slug } = parsed.data;

    // Require admin/owner permission
    const permResult = await requirePermission(request, workspace_id, 'settings:manage');
    if (permResult instanceof NextResponse) return permResult;

    // Service client: upserts sentry installation. Accesses: sentry_installations.
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('sentry_installations')
      .upsert(
        {
          workspace_id,
          installation_uuid,
          organization_slug: organization_slug ?? null,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'installation_uuid' },
      )
      .select('id, workspace_id, installation_uuid, is_active, created_at')
      .single();

    if (error) {
      console.error('[sentry/install] Upsert error:', error);
      return NextResponse.json(
        { error: 'Failed to register Sentry installation' },
        { status: 500 },
      );
    }

    return NextResponse.json({ data });
  } catch (err) {
    return safeErrorResponse(err);
  }
}

/**
 * DELETE — Deactivate Sentry integration for a workspace.
 */
export async function DELETE(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;

  const rateLimitResult = await applyRateLimit(
    request,
    'integrations.sentry.install.delete',
    RATE_WRITE,
  );
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId || !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Valid workspace_id is required' }, { status: 400 });
    }

    const permResult = await requirePermission(request, workspaceId, 'settings:manage');
    if (permResult instanceof NextResponse) return permResult;

    // Service client: deactivates sentry installation. Accesses: sentry_installations.
    const supabase = createServiceClient();

    const { error } = await supabase
      .from('sentry_installations')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);

    if (error) {
      return safeErrorResponse(error);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return safeErrorResponse(err);
  }
}
