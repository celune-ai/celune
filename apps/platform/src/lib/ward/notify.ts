/**
 * apps/platform/src/lib/ward/notify.ts
 *
 * WARD Slack notification for auto-fix results.
 * Sends a Block Kit message with merge/reject buttons when a fix is ready.
 */

import { createServiceClient } from '@repo/db/service';
import { decryptBotToken, decryptWebhookUrl } from '@repo/notifications/decrypt-webhook';
import type { BotTokenFields } from '@repo/notifications/decrypt-webhook';
import type { SlackConnection } from '@repo/notifications/types';
import {
  chatPostMessage,
  headerBlock,
  markdownSection,
  fieldsSection,
  divider,
  actionsBlock,
  button,
  contextBlock,
} from '@/lib/slack-api';
import type { WardFix } from './pipeline';
import type { WardConfig } from './config';

// ── Severity badge ──────────────────────────────────────────────────────────

const SEVERITY_EMOJI: Record<string, string> = {
  fatal: ':red_circle:',
  error: ':large_orange_circle:',
  warning: ':large_yellow_circle:',
  info: ':large_blue_circle:',
  debug: ':white_circle:',
};

// ── Connection resolver ─────────────────────────────────────────────────────

async function resolveSlackConnection(workspaceId: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('slack_connections')
    .select(
      'workspace_id, bot_token_encrypted, bot_token_iv, installation_type, slack_channel_id, encrypted_webhook_url, webhook_iv, incoming_webhook_url',
    )
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .maybeSingle();

  return data;
}

// ── Build notification blocks ───────────────────────────────────────────────

function buildFixBlocks(fix: WardFix) {
  const emoji = SEVERITY_EMOJI[fix.error.level] ?? ':warning:';
  const fixDesc = fix.fix?.description ?? 'No description available';
  const prUrl = fix.fix?.prUrl;
  const branch = fix.fix?.branch;

  const blocks = [
    headerBlock(`${emoji} WARD Auto-Fix Ready`),
    markdownSection(`*${fix.error.title}*`),
    fieldsSection([
      `*Severity:*\n${fix.error.level}`,
      `*Priority:*\n${fix.priority}`,
      `*Culprit:*\n\`${fix.error.culprit}\``,
      `*Fix ID:*\n\`${fix.id}\``,
    ]),
    divider(),
    markdownSection(`*Proposed Fix:*\n${fixDesc}`),
  ];

  if (prUrl) {
    blocks.push(markdownSection(`*Pull Request:* <${prUrl}|View PR>`));
  }

  if (fix.error.sentryUrl) {
    blocks.push(markdownSection(`*Sentry Issue:* <${fix.error.sentryUrl}|View in Sentry>`));
  }

  // Only show Merge/Reject buttons when a real fix exists (has diff or PR)
  // The stub pipeline doesn't generate actual patches — buttons would be misleading
  const hasRealFix = fix.fix?.diff || fix.fix?.prUrl;

  if (hasRealFix) {
    const actionValue = JSON.stringify({
      fix_id: fix.id,
      pr_url: prUrl ?? null,
      branch: branch ?? null,
    });

    blocks.push(
      divider(),
      actionsBlock(
        [
          button('Merge Fix', 'ward_merge_fix', {
            value: actionValue,
            style: 'primary',
          }),
          button('Reject', 'ward_reject_fix', {
            value: actionValue,
            style: 'danger',
          }),
        ],
        `ward_actions_${fix.id}`,
      ),
    );
  } else {
    blocks.push(
      divider(),
      markdownSection(
        '_AI fix generation pending — this is a detection-only alert. No action needed._',
      ),
    );
  }

  blocks.push(
    contextBlock([
      { type: 'mrkdwn', text: `:shield: WARD Auto-Fix Agent | ${new Date().toISOString()}` },
    ]),
  );

  return blocks;
}

// ── Fallback: send via webhook ──────────────────────────────────────────────

async function sendViaWebhook(
  webhookUrl: string,
  fix: WardFix,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `WARD Auto-Fix Ready: ${fix.error.title} (${fix.error.level}) — Fix ID: ${fix.id}`,
        blocks: buildFixBlocks(fix),
      }),
    });

    if (!res.ok) {
      return { success: false, error: `Webhook returned ${res.status}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Failure logging ─────────────────────────────────────────────────────────

async function logNotifyFailure(workspaceId: string, fixId: string, error: string): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      event_type: 'ward.notify_failed',
      severity: 'warning',
      source: 'ward-pipeline',
      title: `WARD notification failed for fix ${fixId}`.slice(0, 200),
      details: JSON.stringify({ fix_id: fixId, error }),
    });
  } catch {
    // Best-effort — don't let logging failures cascade
  }
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Send a Slack notification when WARD generates a fix.
 * Resolves the workspace's Slack connection for bot token.
 * Falls back to webhook if no bot token is available.
 */
export async function notifyFixReady(opts: {
  workspaceId: string;
  fix: WardFix;
  config: WardConfig;
}): Promise<{ success: boolean; error?: string }> {
  const { workspaceId, fix, config } = opts;

  // Resolve Slack connection
  const conn = await resolveSlackConnection(workspaceId);

  if (!conn) {
    return { success: false, error: 'No active Slack connection for workspace' };
  }

  // Determine target channel: config override > connection default
  const channel = config.slackNotifyChannel ?? conn.slack_channel_id;

  if (!channel) {
    return { success: false, error: 'No Slack channel configured for WARD notifications' };
  }

  // Try bot token first
  const botToken = decryptBotToken(conn as BotTokenFields);

  if (botToken) {
    const blocks = buildFixBlocks(fix);
    const fallbackText = `WARD Auto-Fix Ready: ${fix.error.title} (${fix.error.level})`;

    const result = await chatPostMessage(botToken, channel, fallbackText, {
      blocks,
      username: 'WARD',
      icon_url: undefined,
    });

    if (result.ok) {
      return { success: true };
    }

    // Block Kit failed — try plain text as last resort
    console.warn(`[ward-notify] Block Kit failed (${result.error}), trying plain text`);
    const plainResult = await chatPostMessage(botToken, channel, fallbackText, {
      username: 'WARD',
      icon_url: undefined,
    });

    if (plainResult.ok) {
      return { success: true };
    }

    // Log to activity_log so it surfaces in admin feed
    await logNotifyFailure(workspaceId, fix.id, result.error ?? 'Slack API call failed');
    return { success: false, error: result.error ?? 'Slack API call failed' };
  }

  // Fallback to webhook
  const webhookUrl = decryptWebhookUrl(conn as SlackConnection);
  if (webhookUrl) {
    const webhookResult = await sendViaWebhook(webhookUrl, fix);
    if (!webhookResult.success) {
      await logNotifyFailure(workspaceId, fix.id, webhookResult.error ?? 'Webhook failed');
    }
    return webhookResult;
  }

  await logNotifyFailure(workspaceId, fix.id, 'No bot token or webhook URL available');
  return { success: false, error: 'No bot token or webhook URL available' };
}
