import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { getAuthUserId } from '@/lib/auth';
import { z } from 'zod';
import { NOTIFICATION_CHANNELS } from '@repo/notifications';
import { extractRequiredWorkspaceId } from '@/lib/require-workspace';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';

export const dynamic = 'force-dynamic';

const upsertSchema = z.object({
  workspace_id: z.string().uuid(),
  channel: z.enum(['slack', 'email', 'discord', 'teams', 'telegram']),
  event_types: z.array(z.string()).default(['task.completed', 'task.blocked']),
  slack_channel: z.string().max(100).nullable().optional(),
  email_address: z.string().email().nullable().optional(),
  frequency: z.enum(['immediate', 'digest_daily', 'digest_weekly', 'off']).default('immediate'),
  is_enabled: z.boolean().default(true),
});

/**
 * GET /api/notifications/preferences?workspace_id=xxx
 * Returns the current user's notification preferences for the workspace.
 */
export async function GET(request: NextRequest) {
  try {
    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    const permResult = await requirePermission(request, workspaceId, 'settings:read');
    if (permResult instanceof NextResponse) return permResult;

    const userId = await getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Service client: reads user notification preferences. Accesses: notification_preferences.
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('notification_preferences')
      .select(
        'id, user_id, workspace_id, channel, event_types, slack_channel, email_address, frequency, is_enabled, created_at, updated_at',
      )
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .order('channel');

    if (error) {
      return safeErrorResponse(error);
    }

    return NextResponse.json({ preferences: data ?? [] });
  } catch (err) {
    return safeErrorResponse(err);
  }
}

/**
 * PUT /api/notifications/preferences
 * Upsert a notification preference for the current user.
 */
type UpsertBody = z.infer<typeof upsertSchema>;

export const PUT = withApiSecurity<UpsertBody>(
  async (_request: NextRequest, { userId, body }: SecurityContext<UpsertBody>) => {
    // Service client: upserts user notification preference. Accesses: notification_preferences.
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('notification_preferences')
      .upsert(
        {
          user_id: userId,
          workspace_id: body.workspace_id,
          channel: body.channel,
          event_types: body.event_types,
          slack_channel: body.slack_channel ?? null,
          email_address: body.email_address ?? null,
          frequency: body.frequency,
          is_enabled: body.is_enabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,workspace_id,channel' },
      )
      .select(
        'id, user_id, workspace_id, channel, event_types, slack_channel, email_address, frequency, is_enabled, created_at, updated_at',
      )
      .single();

    if (error) throw error;

    return NextResponse.json({ preference: data }, { status: 200 });
  },
  {
    permission: 'settings:read',
    rateLimit: { tier: RATE_WRITE, routeKey: 'notifications.preferences.put' },
    parseBody: upsertSchema,
  },
);

/**
 * DELETE /api/notifications/preferences?workspace_id=xxx&channel=slack
 * Remove a notification preference for the current user.
 */
export const DELETE = withApiSecurity(
  async (request: NextRequest, { userId }: SecurityContext) => {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    const channel = request.nextUrl.searchParams.get('channel');

    if (!workspaceId || !channel) {
      return NextResponse.json({ error: 'workspace_id and channel are required' }, { status: 400 });
    }

    if (!NOTIFICATION_CHANNELS.includes(channel as (typeof NOTIFICATION_CHANNELS)[number])) {
      return NextResponse.json({ error: 'Invalid channel' }, { status: 400 });
    }

    // Service client: deletes user notification preference. Accesses: notification_preferences.
    const supabase = createServiceClient();
    const { error } = await supabase
      .from('notification_preferences')
      .delete()
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .eq('channel', channel);

    if (error) throw error;

    return NextResponse.json({ success: true });
  },
  {
    permission: 'settings:read',
    rateLimit: { tier: RATE_WRITE, routeKey: 'notifications.preferences.delete' },
  },
);
