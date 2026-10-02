/**
 * POST /api/slack/interactions
 *
 * Slack Interactive Components endpoint. Handles:
 * - Block actions (button clicks from Home Tab, notifications, WARD merge/reject)
 * - Shortcut callbacks
 * - View submissions (modal forms)
 *
 * All payloads are verified via HMAC-SHA256 signature before processing.
 * Must respond within 3 seconds — async work is deferred via after().
 *
 * Shared by: Slack App Fix project + WARD Auto-Fix Agent project.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { after } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { createActivity } from '@repo/db/queries';
import { verifySlackSignature } from '@/lib/slack-verify';
import { decryptBotToken } from '@repo/notifications/decrypt-webhook';
import type { BotTokenFields } from '@repo/notifications/decrypt-webhook';
import { chatPostMessage, markdownSection, contextBlock } from '@/lib/slack-api';
import { APP_URL } from '@/lib/branding';

export const dynamic = 'force-dynamic';

// ── Types ───────────────────────────────────────────────────────────────────

interface SlackUser {
  id: string;
  username?: string;
  name?: string;
}

interface SlackAction {
  type: string;
  action_id: string;
  block_id?: string;
  value?: string;
  text?: { type: string; text: string };
}

interface SlackInteractionPayload {
  type: 'block_actions' | 'shortcut' | 'view_submission' | 'view_closed';
  trigger_id?: string;
  user: SlackUser;
  team?: { id: string; domain?: string };
  channel?: { id: string; name?: string };
  message?: { ts: string; text?: string };
  actions?: SlackAction[];
  view?: {
    id: string;
    callback_id?: string;
    state?: { values: Record<string, Record<string, { value?: string }>> };
  };
  response_url?: string;
}

// ── Action handlers ─────────────────────────────────────────────────────────

async function handleStatusCheck(workspaceId: string, botToken: string, channelId: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tasks')
    .select('status')
    .eq('workspace_id', workspaceId)
    .neq('status', 'done');

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }

  const total = data?.length ?? 0;
  const lines = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([status, count]) => `• *${status}*: ${count}`)
    .join('\n');

  await chatPostMessage(botToken, channelId, `${total} open tasks`, {
    blocks: [
      markdownSection(`:clipboard: *Task Status* (${total} open)`),
      markdownSection(lines || '_No open tasks_'),
    ],
  });
}

async function handleCreateTask(
  workspaceId: string,
  botToken: string,
  channelId: string,
  userId: string,
) {
  // For button-triggered task creation, send a prompt message
  // Full modal-based creation requires a trigger_id + views.open call
  await chatPostMessage(
    botToken,
    channelId,
    'Use `/celune task create <title>` to create a task, or visit the dashboard.',
    {
      blocks: [
        markdownSection(
          ':memo: To create a task, use:\n`/celune task create <title>`\n\nOr visit your <' +
            APP_URL +
            '|dashboard>.',
        ),
      ],
    },
  );
}

/**
 * Handle WARD auto-fix merge/reject buttons.
 * action_id: ward_merge_fix or ward_reject_fix
 * value: JSON with { fix_id, pr_url, branch }
 */
async function handleWardAction(
  actionId: string,
  value: string,
  workspaceId: string,
  botToken: string,
  channelId: string,
  messageTs: string,
  user: SlackUser,
) {
  let fixData: { fix_id?: string; pr_url?: string; branch?: string };
  try {
    fixData = JSON.parse(value);
  } catch {
    fixData = {};
  }

  // Sanitize user-controlled fields to prevent Slack mrkdwn injection
  const fixId = String(fixData.fix_id ?? 'unknown').replace(/[<>|`]/g, '');
  const prUrl =
    fixData.pr_url && /^https:\/\/github\.com\//.test(fixData.pr_url) ? fixData.pr_url : null;

  const supabase = createServiceClient();

  if (actionId === 'ward_merge_fix') {
    // Record merge approval
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      event_type: 'ward.fix_approved',
      severity: 'info',
      source: 'slack-interactions',
      title: `WARD fix ${fixId} approved by ${user.username ?? user.id}`,
      details: { fix_id: fixId, pr_url: prUrl, approved_by: user.id },
    });

    // Acknowledge in thread
    await chatPostMessage(botToken, channelId, `Fix ${fixId} approved for merge`, {
      blocks: [
        markdownSection(
          `:white_check_mark: *Fix approved* by <@${user.id}>\nPR: ${prUrl ?? 'N/A'}`,
        ),
        contextBlock([{ type: 'mrkdwn', text: `Fix ID: \`${fixId}\`` }]),
      ],
      thread_ts: messageTs,
    });
  } else if (actionId === 'ward_reject_fix') {
    // Record rejection
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      event_type: 'ward.fix_rejected',
      severity: 'info',
      source: 'slack-interactions',
      title: `WARD fix ${fixId} rejected by ${user.username ?? user.id}`,
      details: { fix_id: fixId, rejected_by: user.id },
    });

    await chatPostMessage(botToken, channelId, `Fix ${fixId} rejected`, {
      blocks: [
        markdownSection(`:x: *Fix rejected* by <@${user.id}>`),
        contextBlock([{ type: 'mrkdwn', text: `Fix ID: \`${fixId}\`` }]),
      ],
      thread_ts: messageTs,
    });
  }
}

// ── Workspace + bot token resolution ────────────────────────────────────────

async function resolveConnection(teamId: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('slack_connections')
    .select('workspace_id, bot_token_encrypted, bot_token_iv, installation_type, slack_channel_id')
    .eq('slack_team_id', teamId)
    .eq('is_active', true)
    .maybeSingle();
  return data;
}

// ── POST handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // Verify Slack signature (HMAC-SHA256)
    const sig = request.headers.get('x-slack-signature');
    const ts = request.headers.get('x-slack-request-timestamp');
    const verification = verifySlackSignature(sig, ts, rawBody);

    if (!verification.valid) {
      return NextResponse.json({ error: verification.reason }, { status: 401 });
    }

    // Interactive payloads are URL-encoded with a single "payload" field
    const params = new URLSearchParams(rawBody);
    const payloadStr = params.get('payload');

    if (!payloadStr) {
      return NextResponse.json({ error: 'Missing payload' }, { status: 400 });
    }

    let payload: SlackInteractionPayload;
    try {
      payload = JSON.parse(payloadStr);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    // Ack immediately — Slack requires a response within 3 seconds
    // All async work happens in after()
    if (payload.type === 'block_actions' && payload.actions?.length) {
      const teamId = payload.team?.id ?? '';
      const user = payload.user;
      const channelId = payload.channel?.id ?? '';
      const messageTs = payload.message?.ts ?? '';

      after(async () => {
        try {
          const conn = await resolveConnection(teamId);
          if (!conn) {
            console.warn(`[slack/interactions] No connection for team ${teamId}`);
            return;
          }

          const botToken = decryptBotToken(conn as BotTokenFields);
          if (!botToken) {
            console.warn(`[slack/interactions] No bot token for team ${teamId}`);
            return;
          }

          const workspaceId = conn.workspace_id;
          const replyChannel = channelId || conn.slack_channel_id || '';

          for (const action of payload.actions ?? []) {
            switch (action.action_id) {
              // ── Home Tab quick actions ────────────────────────────
              case 'celune_status':
                await handleStatusCheck(workspaceId, botToken, replyChannel);
                break;

              case 'celune_create_task':
                await handleCreateTask(workspaceId, botToken, replyChannel, user.id);
                break;

              case 'celune_dashboard':
                // URL button — no server action needed, Slack opens the URL
                break;

              case 'celune_connect':
                // URL button — no server action needed
                break;

              // ── WARD auto-fix actions ─────────────────────────────
              case 'ward_merge_fix':
              case 'ward_reject_fix':
                await handleWardAction(
                  action.action_id,
                  action.value ?? '{}',
                  workspaceId,
                  botToken,
                  replyChannel,
                  messageTs,
                  user,
                );
                break;

              // ── Notification action buttons ───────────────────────
              case 'view_task':
              case 'view_dashboard':
                // URL buttons — no server action needed
                break;

              default:
                console.info(`[slack/interactions] Unhandled action: ${action.action_id}`);

                // Log unhandled actions for observability
                try {
                  const supabase = createServiceClient();
                  await createActivity(supabase, {
                    event_type: 'slack.unhandled_action',
                    severity: 'info',
                    source: 'slack-interactions',
                    title: `Unhandled action: ${action.action_id}`,
                    details: {
                      action_id: action.action_id,
                      block_id: action.block_id,
                      team_id: teamId,
                      user_id: user.id,
                    },
                  });
                } catch {
                  // Non-fatal
                }
            }
          }
        } catch (err) {
          console.error('[slack/interactions] Error processing actions:', err);
        }
      });
    }

    // Empty 200 response — Slack interprets this as successful acknowledgement
    return new NextResponse(null, { status: 200 });
  } catch (err) {
    // Always return 200 to prevent Slack from retry storms
    console.error('[slack/interactions] Unhandled error:', err);
    return new NextResponse(null, { status: 200 });
  }
}
