import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { validateOrigin } from '@/lib/csrf';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { getAuthUserId } from '@/lib/auth';
import { sendEmailNotification } from '@repo/notifications';
import { sendSlackNotification, sendSlackBotNotification } from '@repo/notifications/senders/slack';
import { decryptBotToken } from '@repo/notifications/decrypt-webhook';
import { conversationsOpen } from '@/lib/slack-api';
import { z } from 'zod';
import { URL_APP } from '@/lib/branding';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

const SUPPORTED_EVENT_TYPES = [
  'task.completed',
  'task.assigned',
  'task.blocked',
  'review.requested',
  'review.completed',
  'agent.status_changed',
] as const;

const TEST_EVENT_PAYLOADS: Record<string, { actorAgent: string; payload: Record<string, string> }> =
  {
    'task.completed': {
      actorAgent: 'rick',
      payload: {
        task_title: 'Test Task',
        outcome: 'Task completed successfully. This is a test notification.',
      },
    },
    'task.assigned': {
      actorAgent: 'rick',
      payload: { task_title: 'Design homepage layout', assignee: 'noir' },
    },
    'task.blocked': {
      actorAgent: 'rick',
      payload: { task_title: 'Deploy auth service', reason: 'Waiting on API key provisioning' },
    },
    'review.requested': {
      actorAgent: 'scan',
      payload: { pr_title: 'feat: add webhook retry logic', pr_number: '42' },
    },
    'review.completed': {
      actorAgent: 'scan',
      payload: {
        pr_title: 'feat: add webhook retry logic',
        result: 'approved',
        findings: '0 critical, 2 suggestions',
      },
    },
    'agent.status_changed': {
      actorAgent: 'rick',
      payload: { agent: 'RICK', status: 'online', previous_status: 'offline' },
    },
  };

const testSchema = z.object({
  workspaceId: z.string().uuid(),
  channel: z.enum(['slack', 'email']),
  eventType: z.enum(SUPPORTED_EVENT_TYPES).optional(),
});

/**
 * POST /api/notifications/test
 *
 * Sends a test notification to the requesting user only.
 * Requires workspace membership (settings:read permission).
 * Does NOT require INTERNAL_API_KEY — this is a user-facing action.
 *
 * Body: { workspaceId, channel }
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'notifications.test.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const body = await parseBody(request, testSchema);
    if (isErrorResponse(body)) return body;

    const permResult = await requirePermission(request, body.workspaceId, 'settings:read');
    if (permResult instanceof NextResponse) return permResult;

    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const eventType = body.eventType ?? 'task.completed';
    const eventConfig = TEST_EVENT_PAYLOADS[eventType] ?? TEST_EVENT_PAYLOADS['task.completed'];

    const testEvent = {
      type: eventType,
      workspaceId: body.workspaceId,
      actorAgent: eventConfig.actorAgent,
      payload: {
        ...eventConfig.payload,
        dashboard_url: `${process.env['NEXT_PUBLIC_APP_URL'] ?? URL_APP}/w/${body.workspaceId}`,
      },
    };

    // Service client: reads user notification preferences and slack connection for test send. Accesses: notification_preferences, slack_connections.
    const supabase = createServiceClient();

    if (body.channel === 'email') {
      // Check that email sending is configured before attempting
      if (!process.env['AGENTMAIL_API_KEY']) {
        return NextResponse.json(
          { error: 'Email notifications are not configured yet. Contact support to enable.' },
          { status: 503 },
        );
      }

      // Resolve email: prefer saved preference email_address, fall back to auth email
      const { data: pref } = await supabase
        .from('notification_preferences')
        .select('email_address')
        .eq('user_id', userId)
        .eq('workspace_id', body.workspaceId)
        .eq('channel', 'email')
        .maybeSingle();

      let toAddress: string | null = pref?.email_address ?? null;
      if (!toAddress) {
        const { data: userRecord } = await supabase.auth.admin.getUserById(userId);
        toAddress = userRecord.user?.email ?? null;
      }

      if (!toAddress) {
        return NextResponse.json(
          { error: 'No email address on file for your account' },
          { status: 400 },
        );
      }

      const result = await sendEmailNotification(toAddress, testEvent);
      if (!result.success) {
        return NextResponse.json(
          { error: result.error ?? 'Failed to send test email' },
          { status: 502 },
        );
      }

      return NextResponse.json({ sent: true, channel: 'email' });
    }

    if (body.channel === 'slack') {
      const { data: conn } = await supabase
        .from('slack_connections')
        .select(
          'incoming_webhook_url, slack_channel, slack_channel_id, installation_type, bot_token_encrypted, bot_token_iv, bot_display_name, bot_icon_url, encrypted_webhook_url, webhook_iv, installer_slack_user_id',
        )
        .eq('workspace_id', body.workspaceId)
        .eq('is_active', true)
        .maybeSingle();

      if (!conn) {
        return NextResponse.json(
          { error: 'No active Slack connection for this workspace' },
          { status: 400 },
        );
      }

      // Check the user's saved slack channel preference if set
      const { data: pref } = await supabase
        .from('notification_preferences')
        .select('slack_channel')
        .eq('user_id', userId)
        .eq('workspace_id', body.workspaceId)
        .eq('channel', 'slack')
        .maybeSingle();

      const channelOverride = pref?.slack_channel ?? null;
      const dashboardUrl = testEvent.payload.dashboard_url as string;

      // Use bot token for bot installs, webhook for legacy installs
      const botToken = decryptBotToken(conn);
      let result: { success: boolean; error?: string };

      if (botToken && conn.installation_type === 'bot') {
        // Resolve channel: user preference → workspace default → DM to installer
        let channel = channelOverride ?? conn.slack_channel_id ?? '';
        if (!channel && conn.installer_slack_user_id) {
          // No channel configured — fall back to DM with the user who installed the bot
          const dmChannelId = await conversationsOpen(botToken, conn.installer_slack_user_id);
          if (dmChannelId) channel = dmChannelId;
        }
        if (!channel) {
          return NextResponse.json(
            {
              error:
                'No Slack channel configured and could not open a DM. Invite the bot to a channel or reconnect Slack.',
            },
            { status: 400 },
          );
        }
        result = await sendSlackBotNotification(botToken, channel, testEvent, dashboardUrl, {
          username: conn.bot_display_name ?? undefined,
          icon_url: conn.bot_icon_url ?? undefined,
        });
      } else {
        result = await sendSlackNotification(
          conn.incoming_webhook_url,
          testEvent,
          channelOverride,
          dashboardUrl,
        );
      }

      if (!result.success) {
        return NextResponse.json(
          { error: result.error ?? 'Failed to send Slack message' },
          { status: 502 },
        );
      }

      return NextResponse.json({ sent: true, channel: 'slack' });
    }

    return NextResponse.json({ error: 'Unsupported channel' }, { status: 400 });
  } catch (err) {
    return safeErrorResponse(err);
  }
}
