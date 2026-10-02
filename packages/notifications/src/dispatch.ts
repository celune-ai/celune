/**
 * packages/notifications/src/dispatch.ts
 *
 * Core notification dispatch router.
 *
 * Flow:
 *   1. Query notification_preferences for all users in workspace subscribed to this event type
 *   2. For Slack: look up slack_connections for the workspace
 *   3. Fan out to appropriate senders per preference
 *   4. Log each attempt to activity_log (notification.sent / notification.failed)
 *
 * All sends are best-effort. Failures never propagate to the caller.
 */

import { createServiceClient } from '@repo/db/service';
import { sendSlackNotification, sendSlackBotNotification } from './senders/slack';
import { sendEmailNotification } from './senders/email';
import { decryptWebhookUrl, decryptBotToken } from './decrypt-webhook';
import type {
  NotificationEvent,
  NotificationPreference,
  SlackConnection,
  DispatchResult,
} from './types';

import { DEFAULT_APP_URL } from './branding';

const APP_URL = DEFAULT_APP_URL;

const SLACK_API_BASE = 'https://slack.com/api';

/** Open a DM channel with a Slack user. Returns channel ID or null. */
async function openDmChannel(botToken: string, slackUserId: string): Promise<string | null> {
  try {
    const res = await fetch(`${SLACK_API_BASE}/conversations.open`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ users: slackUserId }),
    });
    const data = (await res.json()) as { ok: boolean; channel?: { id: string } };
    return data.ok ? (data.channel?.id ?? null) : null;
  } catch {
    return null;
  }
}

function buildDashboardUrl(workspaceId: string, payload: Record<string, unknown>): string {
  const taskId = payload.task_id as string | undefined;
  if (taskId) {
    return `${APP_URL}/w/${workspaceId}/tasks/${taskId}`;
  }
  return `${APP_URL}/w/${workspaceId}`;
}

async function logNotificationAttempt(
  event: NotificationEvent,
  result: DispatchResult,
  preferenceId: string,
): Promise<void> {
  try {
    // Service client: notification dispatch logging. Accesses: activity_log.
    const supabase = createServiceClient();
    await supabase.from('activity_log').insert({
      event_type: result.success ? 'notification.sent' : 'notification.failed',
      workspace_id: event.workspaceId,
      source: 'notification_service',
      title: result.success
        ? `Notification sent via ${result.channel}`
        : `Notification failed via ${result.channel}`,
      details: {
        notification_event_type: event.type,
        channel: result.channel,
        actor_agent: event.actorAgent,
        preference_id: preferenceId,
        error: result.error,
      },
    });
  } catch {
    // Logging failure is non-fatal — swallow silently
  }
}

/**
 * Dispatch a notification event to all subscribed users in the workspace.
 *
 * Best-effort: will not throw. Returns array of dispatch results for observability.
 */
export async function dispatchNotification(event: NotificationEvent): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];

  try {
    // Service client: notification dispatch. Accesses: notification_preferences, slack_connections.
    const supabase = createServiceClient();

    // 1. Find all enabled preferences for this workspace that include this event type
    const { data: preferences, error: prefError } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('workspace_id', event.workspaceId)
      .eq('is_enabled', true)
      .neq('frequency', 'off')
      .contains('event_types', [event.type]);

    if (prefError) {
      console.error('[notifications] Failed to load preferences:', prefError.message);
      return results;
    }

    if (!preferences || preferences.length === 0) {
      return results;
    }

    const prefs = preferences as NotificationPreference[];

    // 2. Check if we need Slack — load the workspace's slack_connection once
    const needsSlack = prefs.some((p) => p.channel === 'slack');
    let slackConn: SlackConnection | null = null;

    if (needsSlack) {
      const { data: conn } = await supabase
        .from('slack_connections')
        .select('*')
        .eq('workspace_id', event.workspaceId)
        .eq('is_active', true)
        .single();

      slackConn = conn as SlackConnection | null;
    }

    // 3. Fan out to each preference
    const dashboardUrl = buildDashboardUrl(event.workspaceId, event.payload);
    const enrichedPayload = {
      ...event.payload,
      dashboard_url: dashboardUrl,
    };
    const enrichedEvent: NotificationEvent = { ...event, payload: enrichedPayload };

    const dispatches = prefs.map(async (pref) => {
      let result: DispatchResult;

      if (pref.channel === 'slack') {
        if (!slackConn) {
          result = {
            channel: 'slack',
            success: false,
            error: 'No active Slack connection for workspace',
          };
        } else {
          // Prefer bot token (richer notifications with buttons) over webhook
          const botToken = decryptBotToken(slackConn);
          if (botToken && slackConn.installation_type === 'bot') {
            // Bot token install — use chat.postMessage for interactive notifications
            // Channel priority: user preference → workspace default → DM to installer
            let channel = pref.slack_channel ?? slackConn.slack_channel_id ?? '';
            if (!channel && slackConn.installer_slack_user_id) {
              const dmChannel = await openDmChannel(botToken, slackConn.installer_slack_user_id);
              if (dmChannel) channel = dmChannel;
            }
            if (!channel) {
              result = {
                channel: 'slack',
                success: false,
                error: 'No Slack channel configured and DM fallback unavailable',
              };
            } else {
              const sendResult = await sendSlackBotNotification(
                botToken,
                channel,
                enrichedEvent,
                dashboardUrl,
                {
                  username: slackConn.bot_display_name ?? undefined,
                  icon_url: slackConn.bot_icon_url ?? undefined,
                },
              );
              result = { channel: 'slack', ...sendResult };
            }
          } else {
            // Legacy webhook install — use incoming webhook
            const webhookUrl = decryptWebhookUrl(slackConn);
            if (!webhookUrl) {
              result = { channel: 'slack', success: false, error: 'No webhook URL configured' };
            } else {
              const sendResult = await sendSlackNotification(
                webhookUrl,
                enrichedEvent,
                pref.slack_channel,
                dashboardUrl,
              );
              result = { channel: 'slack', ...sendResult };
            }
          }
        }
      } else if (pref.channel === 'email') {
        // Resolve email: use preference email_address or fall back to user's auth email
        let toAddress = pref.email_address;
        if (!toAddress) {
          const { data: userRecord } = await supabase.auth.admin.getUserById(pref.user_id);
          toAddress = userRecord.user?.email ?? null;
        }
        if (!toAddress) {
          result = { channel: 'email', success: false, error: 'No email address for user' };
        } else {
          const sendResult = await sendEmailNotification(toAddress, enrichedEvent);
          result = { channel: 'email', ...sendResult };
        }
      } else {
        // Channel not yet implemented (discord, teams, telegram)
        result = {
          channel: pref.channel,
          success: false,
          error: `Channel ${pref.channel} not yet implemented`,
        };
      }

      // Log the attempt
      await logNotificationAttempt(event, result, pref.id);
      return result;
    });

    const settled = await Promise.allSettled(dispatches);
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        results.push(s.value);
      } else {
        results.push({ channel: 'slack', success: false, error: s.reason?.message });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[notifications] Dispatch error:', message);
  }

  return results;
}
