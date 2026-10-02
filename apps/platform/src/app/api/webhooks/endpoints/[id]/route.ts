import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { validateOrigin } from '@/lib/csrf';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { isValidUuid } from '@repo/db/validation';
import { z } from 'zod';
import { ALL_WEBHOOK_EVENTS } from '@/lib/webhooks';
import { auditLog } from '@/lib/audit-log';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

const updateWebhookSchema = z
  .object({
    url: z.string().url().min(10).max(2000).optional(),
    events: z.array(z.string()).min(1).optional(),
    description: z.string().max(500).optional().nullable(),
    is_active: z.boolean().optional(),
  })
  .strip();

/**
 * PATCH /api/webhooks/endpoints/[id]
 * Update a webhook endpoint's URL, events, description, or active status.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'webhooks.endpoints.id.patch', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid webhook endpoint ID' }, { status: 400 });
    }

    // Read endpoint first to get its workspace_id for permission scoping
    const supabase = createServiceClient();
    const { data: existing } = await supabase
      .from('webhook_endpoints')
      .select('workspace_id')
      .eq('id', id)
      .single();
    if (!existing) {
      return NextResponse.json({ error: 'Webhook endpoint not found' }, { status: 404 });
    }

    const permResult = await requirePermission(request, existing.workspace_id, 'webhooks:manage');
    if (permResult instanceof NextResponse) return permResult;

    const parsed = await parseBody(request, updateWebhookSchema);
    if (isErrorResponse(parsed)) return parsed;

    const { data, error } = await supabase
      .from('webhook_endpoints')
      .update(parsed)
      .eq('id', id)
      .eq('workspace_id', existing.workspace_id)
      .select('id, workspace_id, url, events, description, is_active, created_at, updated_at')
      .single();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: 'Webhook endpoint not found' }, { status: 404 });
    }

    auditLog(
      {
        event_type: 'webhook.updated',
        title: `Webhook endpoint updated: ${data.url}`,
        actor_user_id: permResult.userId,
        workspace_id: data.workspace_id,
        resource_type: 'webhook_endpoint',
        resource_id: id,
      },
      request,
    );

    return NextResponse.json(data);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * DELETE /api/webhooks/endpoints/[id]
 * Deactivate a webhook endpoint (soft delete — sets is_active = false).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResult = await applyRateLimit(request, 'webhooks.endpoints.id.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid webhook endpoint ID' }, { status: 400 });
    }

    // Read endpoint first to get its workspace_id for permission scoping
    const supabase = createServiceClient();
    const { data: existing } = await supabase
      .from('webhook_endpoints')
      .select('workspace_id')
      .eq('id', id)
      .single();
    if (!existing) {
      return NextResponse.json({ error: 'Webhook endpoint not found' }, { status: 404 });
    }

    const permResult = await requirePermission(request, existing.workspace_id, 'webhooks:manage');
    if (permResult instanceof NextResponse) return permResult;

    const { data, error } = await supabase
      .from('webhook_endpoints')
      .delete()
      .eq('id', id)
      .eq('workspace_id', existing.workspace_id)
      .select('id, workspace_id, url')
      .single();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: 'Webhook endpoint not found' }, { status: 404 });
    }

    auditLog(
      {
        event_type: 'webhook.deleted',
        title: `Webhook endpoint deleted: ${data.url}`,
        actor_user_id: permResult.userId,
        workspace_id: data.workspace_id,
        resource_type: 'webhook_endpoint',
        resource_id: id,
      },
      request,
    );

    return NextResponse.json({ ok: true, deleted: data });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
