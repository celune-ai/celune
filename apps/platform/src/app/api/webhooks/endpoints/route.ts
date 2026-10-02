import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { z } from 'zod';
import { generateWebhookSecret, ALL_WEBHOOK_EVENTS } from '@/lib/webhooks';
import { auditLog } from '@/lib/audit-log';
import { extractRequiredWorkspaceId } from '@/lib/require-workspace';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';

export const dynamic = 'force-dynamic';

const createWebhookSchema = z
  .object({
    workspace_id: z.string().uuid(),
    url: z.string().url().min(10).max(2000),
    events: z.array(z.string()).min(1).default(['task.completed']),
    description: z.string().max(500).optional(),
  })
  .strip();

/**
 * GET /api/webhooks/endpoints?workspace_id=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    const permResult = await requirePermission(request, workspaceId, 'webhooks:read');
    if (permResult instanceof NextResponse) return permResult;

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('webhook_endpoints')
      .select('id, workspace_id, url, events, description, is_active, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({
      endpoints: data ?? [],
      available_events: ALL_WEBHOOK_EVENTS,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * POST /api/webhooks/endpoints
 * Returns the secret ONCE on creation.
 */
type CreateWebhookBody = z.infer<typeof createWebhookSchema>;

export const POST = withApiSecurity<CreateWebhookBody>(
  async (request: NextRequest, { userId, body }: SecurityContext<CreateWebhookBody>) => {
    const secret = generateWebhookSecret();

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('webhook_endpoints')
      .insert({
        workspace_id: body.workspace_id,
        url: body.url,
        secret,
        events: body.events,
        description: body.description ?? null,
      })
      .select('id, workspace_id, url, events, description, is_active, created_at')
      .single();

    if (error) throw error;

    auditLog(
      {
        event_type: 'webhook.created',
        title: `Webhook endpoint created: ${body.url}`,
        actor_user_id: userId,
        workspace_id: body.workspace_id,
        resource_type: 'webhook_endpoint',
        resource_id: data.id,
      },
      request,
    );

    // Return with secret (shown once)
    return NextResponse.json({ ...data, secret }, { status: 201 });
  },
  {
    permission: 'webhooks:manage',
    rateLimit: { tier: RATE_WRITE, routeKey: 'webhooks.endpoints.post' },
    parseBody: createWebhookSchema,
  },
);
