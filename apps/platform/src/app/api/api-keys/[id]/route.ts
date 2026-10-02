import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { validateOrigin } from '@/lib/csrf';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { updateApiKeySchema } from '@/lib/schemas/api-keys.schema';
import { isValidUuid } from '@repo/db/validation';
import { auditLog } from '@/lib/audit-log';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/api-keys/[id]
 * Update an API key's name, scopes, rate limit, or expiration.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'api-keys.id.patch', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  const workspaceId = request.nextUrl.searchParams.get('workspace_id');
  const permResult = await requirePermission(request, workspaceId, 'api_keys:manage');
  if (permResult instanceof NextResponse) return permResult;

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid API key ID' }, { status: 400 });
    }
    const parsed = await parseBody(request, updateApiKeySchema);
    if (isErrorResponse(parsed)) return parsed;

    const supabase = createServiceClient();
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }
    const { data, error } = await supabase
      .from('api_keys')
      .update(parsed)
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select('id, name, scopes, rate_limit_per_minute, expires_at, realtime_enabled, updated_at')
      .single();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * DELETE /api/api-keys/[id]
 * Revoke an API key (soft delete — sets revoked_at).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResult = await applyRateLimit(request, 'api-keys.id.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  const workspaceId = request.nextUrl.searchParams.get('workspace_id');
  const permResult = await requirePermission(request, workspaceId, 'api_keys:manage');
  if (permResult instanceof NextResponse) return permResult;

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid API key ID' }, { status: 400 });
    }

    const supabase = createServiceClient();
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }
    const { data, error } = await supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .is('revoked_at', null)
      .select('id, name, revoked_at')
      .single();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: 'API key not found or already revoked' }, { status: 404 });
    }

    auditLog(
      {
        event_type: 'api_key.revoked',
        title: `API key revoked: ${data.name}`,
        actor_user_id: permResult.userId,
        resource_type: 'api_key',
        resource_id: id,
      },
      request,
    );

    return NextResponse.json({ ok: true, revoked: data });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
