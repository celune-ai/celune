/**
 * POST /api/slack/events
 *
 * Slack Events API endpoint. Handles:
 * - URL verification challenge (required for Slack app setup)
 * - message events (DM, private channels, group DMs)
 * - app_mention events (@celune in channels)
 * - app_home_opened events (Home Tab views)
 * - reaction_added events (emoji-to-action: 📌 create task, 📋 summarize)
 * - link_shared events (unfurl Celune dashboard URLs)
 * - member_joined_channel events (welcome message)
 * - assistant_thread_started / context_changed (Agent sidebar)
 * - tokens_revoked / app_uninstalled events (cleanup)
 *
 * All events are verified via HMAC-SHA256 signature before processing.
 * Must respond within 3 seconds — async work is deferred.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { after } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { verifySlackSignature } from '@/lib/slack-verify';
import { decryptBotToken } from '@repo/notifications/decrypt-webhook';
import type { BotTokenFields } from '@repo/notifications/decrypt-webhook';
import { publishHomeTab } from '@/lib/slack-home-tab';
import { handleAgentReply } from '@/lib/slack-agent-reply';
import { handleReactionAdded } from '@/lib/slack-reactions';
import { handleLinkShared } from '@/lib/slack-unfurl';
import {
  assistantSetSuggestedPrompts,
  assistantSetStatus,
  assistantSetTitle,
  chatPostMessage,
} from '@/lib/slack-api';

export const dynamic = 'force-dynamic';

// ── Event deduplication (short-lived in-memory set) ──────────────────────

const DEDUP_TTL_MS = 60_000; // 1 minute
const processedEvents = new Map<string, number>();

function isDuplicate(eventId: string): boolean {
  const now = Date.now();
  // Prune expired entries periodically
  if (processedEvents.size > 500) {
    for (const [id, ts] of processedEvents) {
      if (now - ts > DEDUP_TTL_MS) processedEvents.delete(id);
    }
  }
  if (processedEvents.has(eventId)) return true;
  processedEvents.set(eventId, now);
  return false;
}

// ── Types ───────────────────────────────────────────────────────────────────

interface SlackEvent {
  type: string;
  user?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  tab?: string;
  // tokens_revoked payload
  tokens?: { oauth?: string[]; bot?: string[] };
  // reaction_added payload
  reaction?: string;
  item_user?: string;
  item?: { type: string; channel: string; ts: string };
  // link_shared payload
  message_ts?: string;
  links?: { url: string; domain: string }[];
  // assistant_thread_started / context_changed payload
  assistant_thread?: {
    user_id: string;
    channel_id: string;
    thread_ts: string;
    context?: {
      channel_id?: string;
      team_id?: string;
    };
  };
}

interface SlackEventPayload {
  type: string;
  token?: string;
  challenge?: string;
  team_id?: string;
  api_app_id?: string;
  event?: SlackEvent;
  event_id?: string;
  event_time?: number;
}

// ── Event handlers ──────────────────────────────────────────────────────────

async function handleMessageIm(event: SlackEvent, teamId: string) {
  // Ignore bot's own messages to prevent loops
  if (event.bot_id) return;

  const supabase = createServiceClient();

  // Look up the workspace for this Slack team
  const { data: conn } = await supabase
    .from('slack_connections')
    .select('workspace_id, bot_user_id')
    .eq('slack_team_id', teamId)
    .eq('is_active', true)
    .maybeSingle();

  if (!conn) {
    console.warn(`[slack/events] No active connection for team ${teamId}`);
    return;
  }

  // Ignore messages from the bot itself
  if (event.user === conn.bot_user_id) return;

  // Store the message in conversation context
  const threadTs = event.thread_ts ?? event.ts;
  if (!threadTs || !event.channel) return;

  const { data: existing } = await supabase
    .from('slack_conversations')
    .select('id, messages, message_count')
    .eq('slack_team_id', teamId)
    .eq('channel_id', event.channel)
    .eq('thread_ts', threadTs)
    .maybeSingle();

  const newMessage = {
    role: 'user' as const,
    content: event.text ?? '',
    ts: event.ts ?? '',
  };

  if (existing) {
    const messages = Array.isArray(existing.messages) ? existing.messages : [];
    await supabase
      .from('slack_conversations')
      .update({
        messages: [...messages, newMessage],
        message_count: (existing.message_count ?? 0) + 1,
        last_activity: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    await supabase.from('slack_conversations').insert({
      workspace_id: conn.workspace_id,
      slack_team_id: teamId,
      thread_ts: threadTs,
      channel_id: event.channel,
      user_slack_id: event.user ?? 'unknown',
      messages: [newMessage],
      message_count: 1,
      last_activity: new Date().toISOString(),
    });
  }

  // Route to agent for response
  await handleAgentReply({
    workspaceId: conn.workspace_id,
    teamId,
    channelId: event.channel,
    threadTs,
    userMessage: event.text ?? '',
    userId: event.user ?? 'unknown',
  });
}

async function handleAppHomeOpened(event: SlackEvent, teamId: string) {
  if (event.tab !== 'home' || !event.user) return;

  const supabase = createServiceClient();

  // Look up the workspace connection to get bot token (select only needed columns)
  const { data: conn } = await supabase
    .from('slack_connections')
    .select('workspace_id, bot_token_encrypted, bot_token_iv, installation_type')
    .eq('slack_team_id', teamId)
    .eq('is_active', true)
    .maybeSingle();

  if (!conn) {
    console.warn(`[slack/events] app_home_opened: no connection for team ${teamId}`);
    return;
  }

  const botToken = decryptBotToken(conn as BotTokenFields);
  if (!botToken) {
    console.warn(`[slack/events] app_home_opened: no bot token for team ${teamId}`);
    return;
  }

  await publishHomeTab(botToken, event.user, conn.workspace_id);
}

async function handleAppMention(event: SlackEvent, teamId: string) {
  console.info(`[slack/events] app_mention in ${event.channel}`);

  // Store as conversation context same as DM, then reply
  await handleMessageIm(event, teamId);
}

async function handleTokensRevoked(event: SlackEvent, teamId: string) {
  const supabase = createServiceClient();

  // Deactivate the connection when tokens are revoked
  await supabase
    .from('slack_connections')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('slack_team_id', teamId)
    .eq('is_active', true);

  console.info(`[slack/events] tokens_revoked for team ${teamId} — connection deactivated`);
}

async function handleAppUninstalled(teamId: string) {
  const supabase = createServiceClient();

  // Hard-deactivate the connection
  await supabase
    .from('slack_connections')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('slack_team_id', teamId);

  console.info(`[slack/events] app_uninstalled for team ${teamId} — connection deactivated`);
}

// ── Assistant (Agent sidebar) event handlers ─────────────────────────────────

/**
 * Resolve the bot token for a Slack team.
 */
async function resolveBotToken(
  teamId: string,
): Promise<{ token: string; workspaceId: string } | null> {
  const supabase = createServiceClient();
  const { data: conn } = await supabase
    .from('slack_connections')
    .select('workspace_id, bot_token_encrypted, bot_token_iv, installation_type')
    .eq('slack_team_id', teamId)
    .eq('is_active', true)
    .maybeSingle();

  if (!conn) return null;

  const token = decryptBotToken(conn as BotTokenFields);
  if (!token) return null;

  return { token, workspaceId: conn.workspace_id };
}

/**
 * Handle assistant_thread_started — user opens the agent sidebar.
 * Set suggested prompts and a welcome status.
 */
async function handleAssistantThreadStarted(event: SlackEvent, teamId: string) {
  const thread = event.assistant_thread;
  if (!thread) return;

  const resolved = await resolveBotToken(teamId);
  if (!resolved) return;

  const { token, workspaceId } = resolved;
  const channelId = thread.channel_id;
  const threadTs = thread.thread_ts;

  // Set thread title
  await assistantSetTitle(token, channelId, threadTs, 'Celune Agent');

  // Build context-aware suggested prompts
  const contextChannelId = thread.context?.channel_id;
  const prompts: { title: string; message: string }[] = [];

  if (contextChannelId) {
    prompts.push({
      title: `What's happening in this channel?`,
      message: `Summarize the recent activity and key updates in <#${contextChannelId}>`,
    });
  }

  prompts.push(
    { title: 'Task status', message: 'What are my agents working on right now?' },
    { title: 'Create a task', message: 'Help me create a new task for my team' },
    {
      title: 'Project overview',
      message: 'Give me an overview of active projects and their progress',
    },
  );

  await assistantSetSuggestedPrompts(token, channelId, threadTs, prompts);
}

/**
 * Handle assistant_thread_context_changed — user navigated to a different channel.
 * Update suggested prompts based on new context.
 */
async function handleAssistantContextChanged(event: SlackEvent, teamId: string) {
  const thread = event.assistant_thread;
  if (!thread) return;

  const resolved = await resolveBotToken(teamId);
  if (!resolved) return;

  const { token } = resolved;
  const channelId = thread.channel_id;
  const threadTs = thread.thread_ts;
  const contextChannelId = thread.context?.channel_id;

  const prompts: { title: string; message: string }[] = [];

  if (contextChannelId) {
    prompts.push({
      title: `What's happening in this channel?`,
      message: `Summarize the recent activity and key updates in <#${contextChannelId}>`,
    });
  }

  prompts.push(
    { title: 'Task status', message: 'What are my agents working on right now?' },
    { title: 'Create a task', message: 'Help me create a new task for my team' },
    {
      title: 'Project overview',
      message: 'Give me an overview of active projects and their progress',
    },
  );

  await assistantSetSuggestedPrompts(token, channelId, threadTs, prompts);
}

// ── Channel join handler ──────────────────────────────────────────────────────

/**
 * Handle member_joined_channel — send a welcome message when a user
 * joins a channel the bot is in.
 */
async function handleMemberJoinedChannel(event: SlackEvent, teamId: string) {
  if (!event.user || !event.channel) return;

  const resolved = await resolveBotToken(teamId);
  if (!resolved) return;

  // Don't welcome the bot itself
  const supabase = createServiceClient();
  const { data: conn } = await supabase
    .from('slack_connections')
    .select('bot_user_id')
    .eq('slack_team_id', teamId)
    .eq('is_active', true)
    .maybeSingle();

  if (event.user === conn?.bot_user_id) return;

  await chatPostMessage(
    resolved.token,
    event.channel,
    `Welcome! I'm your Celune assistant. DM me or @mention me for help with tasks, projects, and your workspace.`,
    {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:wave: Hey <@${event.user}>! I'm your Celune assistant. Here's what I can do:\n\n• *DM me* or *@mention me* to chat about tasks and projects\n• React with :pushpin: on any message to create a task from it\n• Share a Celune dashboard link for a rich preview\n• Use \`/celune help\` for quick commands`,
          },
        },
      ],
    },
  );

  console.info(`[slack/events] Welcomed ${event.user} in ${event.channel}`);
}

// ── POST handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // Verify Slack signature (HMAC-SHA256)
  const sig = request.headers.get('x-slack-signature');
  const ts = request.headers.get('x-slack-request-timestamp');
  const verification = verifySlackSignature(sig, ts, rawBody);

  if (!verification.valid) {
    return NextResponse.json({ error: verification.reason }, { status: 401 });
  }

  let payload: SlackEventPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // URL verification challenge (required during Slack app setup)
  if (payload.type === 'url_verification') {
    return NextResponse.json({ challenge: payload.challenge });
  }

  // Event callback — must ack within 3 seconds
  if (payload.type === 'event_callback' && payload.event) {
    const teamId = payload.team_id ?? '';
    const event = payload.event;
    const eventId = payload.event_id ?? '';

    // Dedup: skip events we've already processed (Slack retries)
    if (eventId && isDuplicate(eventId)) {
      return NextResponse.json({ ok: true });
    }

    // Use after() to keep the serverless function alive until async work completes
    // This prevents Vercel from killing the function before DB writes finish
    after(async () => {
      try {
        switch (event.type) {
          case 'message':
            // message.im, message.groups, message.mpim all arrive as type "message"
            // with different channel_type values (im, group, mpim)
            await handleMessageIm(event, teamId);
            break;
          case 'app_home_opened':
            await handleAppHomeOpened(event, teamId);
            break;
          case 'app_mention':
            await handleAppMention(event, teamId);
            break;
          case 'reaction_added':
            if (event.reaction && event.item && event.user) {
              await handleReactionAdded(
                {
                  user: event.user,
                  reaction: event.reaction,
                  itemUser: event.item_user,
                  item: event.item,
                },
                teamId,
              );
            }
            break;
          case 'link_shared':
            if (event.links && event.channel && event.message_ts) {
              await handleLinkShared(
                {
                  user: event.user ?? '',
                  channel: event.channel,
                  message_ts: event.message_ts,
                  links: event.links,
                },
                teamId,
              );
            }
            break;
          case 'member_joined_channel':
            await handleMemberJoinedChannel(event, teamId);
            break;
          case 'tokens_revoked':
            await handleTokensRevoked(event, teamId);
            break;
          case 'app_uninstalled':
            await handleAppUninstalled(teamId);
            break;
          case 'assistant_thread_started':
            await handleAssistantThreadStarted(event, teamId);
            break;
          case 'assistant_thread_context_changed':
            await handleAssistantContextChanged(event, teamId);
            break;
          case 'app_rate_limited':
            console.warn(`[slack/events] Rate limited by Slack for team ${teamId}`);
            break;
          default:
            console.info(`[slack/events] Unhandled event type: ${event.type}`);
        }
      } catch (err) {
        console.error(`[slack/events] Error processing ${event.type}:`, err);
      }
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
