/**
 * apps/platform/src/lib/slack-reactions.ts
 *
 * Emoji-to-action handler for Slack reactions.
 * Maps specific emoji reactions to workspace actions:
 *   📌 (pushpin) → Create a task from the message
 *   📋 (clipboard) → Summarize the thread
 */

import { createServiceClient } from '@repo/db/service';
import { decryptBotToken } from '@repo/notifications/decrypt-webhook';
import type { BotTokenFields } from '@repo/notifications/decrypt-webhook';
import {
  conversationsHistory,
  conversationsReplies,
  chatPostMessage,
  markdownSection,
  contextBlock,
} from './slack-api';
import { APP_URL } from '@/lib/branding';

// ── Types ───────────────────────────────────────────────────────────────────

interface ReactionEvent {
  user: string;
  reaction: string;
  itemUser?: string;
  item: {
    type: string;
    channel: string;
    ts: string;
  };
}

interface ReactionContext {
  botToken: string;
  workspaceId: string;
}

// ── Reaction dispatch ────────────────────────────────────────────────────────

/** Reactions we handle — everything else is ignored. */
const REACTION_HANDLERS: Record<
  string,
  (event: ReactionEvent, ctx: ReactionContext) => Promise<void>
> = {
  pushpin: handlePushpinReaction,
  clipboard: handleClipboardReaction,
};

/**
 * Process a reaction_added event.
 * Resolves workspace context, dispatches to the appropriate handler.
 */
export async function handleReactionAdded(event: ReactionEvent, teamId: string): Promise<void> {
  const handler = REACTION_HANDLERS[event.reaction];
  if (!handler) return; // Not an actionable reaction

  const supabase = createServiceClient();

  const { data: conn } = await supabase
    .from('slack_connections')
    .select('workspace_id, bot_token_encrypted, bot_token_iv, installation_type')
    .eq('slack_team_id', teamId)
    .eq('is_active', true)
    .maybeSingle();

  if (!conn) return;

  const botToken = decryptBotToken(conn as BotTokenFields);
  if (!botToken) return;

  try {
    await handler(event, { botToken, workspaceId: conn.workspace_id });
  } catch (err) {
    console.error(`[slack/reactions] Error handling :${event.reaction}:`, err);
  }
}

// ── 📌 Pushpin → Create task ─────────────────────────────────────────────────

async function handlePushpinReaction(event: ReactionEvent, ctx: ReactionContext): Promise<void> {
  // Fetch the reacted-to message text
  const messageText = await fetchMessageText(ctx.botToken, event.item.channel, event.item.ts);
  if (!messageText) {
    console.warn('[slack/reactions] Could not fetch message for pushpin reaction');
    return;
  }

  // Truncate to a reasonable task title (70 char max per convention)
  const title = messageText.length > 70 ? messageText.slice(0, 67) + '...' : messageText;

  const supabase = createServiceClient();

  // Resolve the reacting Slack user's Celune user_id for task ownership
  // Look up via slack_connections → workspace_memberships mapping
  const { data: slackUser } = await supabase
    .from('workspace_memberships')
    .select('user_id, profiles!inner(slack_user_id)')
    .eq('workspace_id', ctx.workspaceId)
    .eq('profiles.slack_user_id', event.user)
    .maybeSingle();

  // Fallback: use the first workspace member if Slack user mapping not found
  const userId = slackUser?.user_id ?? null;
  let resolvedUserId = userId;
  if (!resolvedUserId) {
    const { data: membership } = await supabase
      .from('workspace_memberships')
      .select('user_id')
      .eq('workspace_id', ctx.workspaceId)
      .limit(1)
      .maybeSingle();
    resolvedUserId = membership?.user_id ?? null;
  }

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      workspace_id: ctx.workspaceId,
      user_id: resolvedUserId,
      title,
      description: `## What\n\nTask created from Slack message via 📌 reaction.\n\n> ${messageText}\n\n## Source\n\nSlack channel: <#${event.item.channel}> | Message: ${event.item.ts}`,
      status: 'inbox',
      priority: 'normal',
      source: 'slack',
    })
    .select('id, title')
    .single();

  if (error) {
    console.error('[slack/reactions] Failed to create task:', error);
    return;
  }

  // Confirm in-thread
  const appUrl = APP_URL;
  await chatPostMessage(ctx.botToken, event.item.channel, `📌 Task created: ${task.title}`, {
    blocks: [
      markdownSection(
        `:pushpin: *Task created*\n${task.title}\n<${appUrl}/tasks?id=${task.id}|View in Celune>`,
      ),
      contextBlock([{ type: 'mrkdwn', text: `Created by <@${event.user}>` }]),
    ],
    thread_ts: event.item.ts,
  });

  console.info(`[slack/reactions] 📌 Task created: ${task.id} from reaction by ${event.user}`);
}

// ── 📋 Clipboard → Summarize thread ─────────────────────────────────────────

async function handleClipboardReaction(event: ReactionEvent, ctx: ReactionContext): Promise<void> {
  // Fetch thread replies (conversations.replies returns the full thread for a given ts)
  const history = await conversationsReplies(ctx.botToken, event.item.channel, event.item.ts, {
    inclusive: true,
    limit: 20,
  });

  if (!history.ok || !history.messages?.length) {
    return;
  }

  // Build a simple summary of the thread
  const messages = (history.messages as { text?: string; user?: string; ts?: string }[])
    .filter((m) => m.text)
    .reverse(); // oldest first

  if (messages.length <= 1) {
    await chatPostMessage(
      ctx.botToken,
      event.item.channel,
      'Only one message — nothing to summarize.',
      {
        thread_ts: event.item.ts,
      },
    );
    return;
  }

  const messageCount = messages.length;
  const participants = new Set(messages.map((m) => m.user).filter(Boolean));
  const firstMessage = messages[0]?.text?.slice(0, 100) ?? '';
  const lastMessage = messages[messages.length - 1]?.text?.slice(0, 100) ?? '';

  // For now, provide a structural summary. AI summarization can be added later
  // when we wire this through the same plan-gated AI pipeline.
  await chatPostMessage(
    ctx.botToken,
    event.item.channel,
    `📋 Thread summary: ${messageCount} messages from ${participants.size} participants`,
    {
      blocks: [
        markdownSection(`:clipboard: *Thread Summary*`),
        markdownSection(
          [
            `*Messages:* ${messageCount}`,
            `*Participants:* ${participants.size}`,
            `*Started with:* ${firstMessage}${firstMessage.length >= 100 ? '...' : ''}`,
            `*Latest:* ${lastMessage}${lastMessage.length >= 100 ? '...' : ''}`,
          ].join('\n'),
        ),
        contextBlock([{ type: 'mrkdwn', text: `Requested by <@${event.user}>` }]),
      ],
      thread_ts: event.item.ts,
    },
  );

  console.info(`[slack/reactions] 📋 Thread summarized in ${event.item.channel} by ${event.user}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchMessageText(
  botToken: string,
  channel: string,
  ts: string,
): Promise<string | null> {
  const result = await conversationsHistory(botToken, channel, {
    latest: ts,
    inclusive: true,
    limit: 1,
  });

  if (!result.ok || !result.messages?.length) return null;
  const msg = result.messages[0] as { text?: string };
  return msg.text ?? null;
}
