/**
 * packages/notifications/src/senders/slack.ts
 *
 * Sends notifications to Slack via Incoming Webhooks.
 * Uses Slack Block Kit for structured messages.
 *
 * Design: fire-and-forget from caller perspective.
 * Returns success/failure but never throws to the caller.
 */

import type { NotificationEvent } from '../types';
import { DEFAULT_APP_URL } from '../branding';

// Agent emoji map for visual identity in Slack
const AGENT_EMOJI: Record<string, string> = {
  rick: ':hammer_and_wrench:',
  sage: ':book:',
  noir: ':art:',
  scan: ':mag:',
  delv: ':detective:',
  trek: ':compass:',
  echo: ':speech_balloon:',
  bond: ':handshake:',
  vita: ':seedling:',
};

// Event type human-readable labels
const EVENT_LABELS: Record<string, string> = {
  'task.completed': 'Task Completed',
  'task.assigned': 'Task Assigned',
  'task.blocked': 'Task Blocked — Action Required',
  'review.requested': 'Code Review Requested',
  'review.completed': 'Code Review Complete',
  'agent.status_changed': 'Agent Status Change',
  'deploy.triggered': 'Deployment Triggered',
  'deploy.completed': 'Deployment Complete',
  'digest.weekly': 'Weekly Digest',
};

function buildBlocks(event: NotificationEvent, dashboardUrl: string): object[] {
  const emoji = event.actorAgent ? (AGENT_EMOJI[event.actorAgent] ?? ':robot_face:') : ':bell:';
  const eventLabel = EVENT_LABELS[event.type] ?? event.type;
  const agentName = event.actorAgent
    ? event.actorAgent.charAt(0).toUpperCase() + event.actorAgent.slice(1)
    : 'Celune';

  // Build human-readable summary from payload
  const taskTitle = (event.payload.task_title as string) || (event.payload.title as string) || '';
  const summary = taskTitle ? `*${taskTitle}*` : `Event: ${event.type}`;
  const outcome = (event.payload.outcome as string) || '';
  const blockerReason = (event.payload.blocker_reason as string) || '';
  const bodyText = outcome || blockerReason || (event.payload.description as string) || '';

  const blocks: object[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} ${eventLabel}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: summary + (bodyText ? `\n${bodyText}` : ''),
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'View in Dashboard', emoji: true },
        url: dashboardUrl,
        action_id: 'view_dashboard',
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `*Agent:* ${agentName} • *Time:* <!date^${Math.floor(Date.now() / 1000)}^{date_short_pretty} at {time}|${new Date().toISOString()}>`,
        },
      ],
    },
  ];

  return blocks;
}

/**
 * Send a notification to a Slack channel via Incoming Webhook.
 *
 * @param webhookUrl - The Slack Incoming Webhook URL (stored in slack_connections)
 * @param event - The notification event
 * @param channelOverride - Optional channel override (e.g. '#alerts'). If omitted, uses webhook's default.
 * @param dashboardUrl - URL to link back to the dashboard
 */
export async function sendSlackNotification(
  webhookUrl: string,
  event: NotificationEvent,
  channelOverride: string | null,
  dashboardUrl = DEFAULT_APP_URL,
): Promise<{ success: boolean; error?: string }> {
  try {
    const blocks = buildBlocks(event, dashboardUrl);

    const body: Record<string, unknown> = { blocks };
    if (channelOverride) {
      body.channel = channelOverride;
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown error');
      return { success: false, error: `Slack webhook returned ${response.status}: ${text}` };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Slack send failed: ${message}` };
  }
}

/**
 * Send a notification via Bot API (chat.postMessage) instead of webhook.
 * Used for bot-token installations that support richer interactions.
 *
 * @param botToken - Decrypted bot token (xoxb-)
 * @param channel - Channel ID or user ID for DM
 * @param event - The notification event
 * @param dashboardUrl - URL to link back to the dashboard
 */
export async function sendSlackBotNotification(
  botToken: string,
  channel: string,
  event: NotificationEvent,
  dashboardUrl = DEFAULT_APP_URL,
  opts?: { username?: string; icon_url?: string },
): Promise<{ success: boolean; error?: string; ts?: string }> {
  try {
    const blocks = buildBlocks(event, dashboardUrl);

    // Add interactive buttons for actionable events
    if (['task.completed', 'task.blocked', 'review.requested'].includes(event.type)) {
      const taskId = (event.payload.task_id as string) || '';
      if (taskId) {
        blocks.push({
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'View Task', emoji: true },
              url: `${dashboardUrl}/tasks?id=${taskId}`,
              action_id: 'view_task',
            },
          ],
        });
      }
    }

    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel,
        text: `${EVENT_LABELS[event.type] ?? event.type}: ${(event.payload.task_title as string) || ''}`,
        blocks,
        ...(opts?.username ? { username: opts.username } : {}),
        ...(opts?.icon_url ? { icon_url: opts.icon_url } : {}),
      }),
    });

    const data = (await response.json()) as { ok: boolean; error?: string; ts?: string };

    if (!data.ok) {
      return { success: false, error: `Slack Bot API: ${data.error}` };
    }

    return { success: true, ts: data.ts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Slack bot send failed: ${message}` };
  }
}
