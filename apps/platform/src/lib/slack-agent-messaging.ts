/**
 * apps/platform/src/lib/slack-agent-messaging.ts
 *
 * Agent messaging service for Slack. Enables agents to send structured
 * messages and handle bidirectional conversations with users.
 */

import { createServiceClient } from '@repo/db/service';
import { decryptBotToken } from '@repo/notifications/decrypt-webhook';
import type { SlackConnection } from '@repo/notifications/types';
import {
  type SlackBlock,
  chatPostMessage,
  markdownSection,
  contextBlock,
  divider,
} from './slack-api';

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

// ── Agent message sending ───────────────────────────────────────────────────

export interface AgentMessageOptions {
  workspaceId: string;
  channel: string;
  text: string;
  blocks?: SlackBlock[];
  threadTs?: string;
  agent?: string;
}

/**
 * Send a message as the Celune bot to a Slack channel or DM.
 * Resolves the bot token from the workspace's Slack connection.
 */
export async function sendAgentMessage(opts: AgentMessageOptions) {
  const supabase = createServiceClient();

  const { data: conn } = await supabase
    .from('slack_connections')
    .select(
      'workspace_id, bot_token_encrypted, bot_token_iv, installation_type, slack_channel_id, bot_display_name, bot_icon_url',
    )
    .eq('workspace_id', opts.workspaceId)
    .eq('is_active', true)
    .maybeSingle();

  if (!conn) {
    return { success: false, error: 'No active Slack connection for workspace' };
  }

  const botToken = decryptBotToken(conn as SlackConnection);
  if (!botToken) {
    return { success: false, error: 'No bot token available (webhook-only installation)' };
  }

  // Build blocks with agent identity
  const blocks = opts.blocks ?? [markdownSection(opts.text)];
  if (opts.agent) {
    const emoji = AGENT_EMOJI[opts.agent] ?? ':robot_face:';
    blocks.push(contextBlock([{ type: 'mrkdwn', text: `${emoji} *${opts.agent.toUpperCase()}*` }]));
  }

  const result = await chatPostMessage(botToken, opts.channel, opts.text, {
    blocks,
    thread_ts: opts.threadTs,
    username: conn.bot_display_name ?? undefined,
    icon_url: conn.bot_icon_url ?? undefined,
  });

  // Store outbound message in conversation context
  if (result.ok && opts.threadTs) {
    const threadTs = opts.threadTs;
    const { data: existing } = await supabase
      .from('slack_conversations')
      .select('id, messages, message_count')
      .eq('workspace_id', opts.workspaceId)
      .eq('thread_ts', threadTs)
      .maybeSingle();

    const newMessage = {
      role: 'assistant' as const,
      content: opts.text,
      agent: opts.agent,
      ts: result.ts ?? new Date().toISOString(),
    };

    if (existing) {
      const messages = Array.isArray(existing.messages) ? existing.messages : [];
      await supabase
        .from('slack_conversations')
        .update({
          messages: [...messages, newMessage],
          message_count: (existing.message_count ?? 0) + 1,
          active_agent: opts.agent ?? null,
          last_activity: new Date().toISOString(),
        })
        .eq('id', existing.id);
    }
  }

  return {
    success: result.ok,
    error: result.error,
    ts: result.ts,
    channel: result.channel,
  };
}

// ── Block Kit templates for common agent messages ───────────────────────────

export function taskUpdateBlocks(task: {
  title: string;
  status: string;
  outcome?: string;
  agent?: string;
}): SlackBlock[] {
  const statusEmoji: Record<string, string> = {
    done: ':white_check_mark:',
    blocked: ':no_entry:',
    in_progress: ':hourglass:',
    review: ':eyes:',
  };
  const emoji = statusEmoji[task.status] ?? ':clipboard:';

  const blocks: SlackBlock[] = [
    markdownSection(`${emoji} *${task.title}*\nStatus: *${task.status}*`),
  ];

  if (task.outcome) {
    blocks.push(markdownSection(`> ${task.outcome.slice(0, 200)}`));
  }

  return blocks;
}

export function blockerAlertBlocks(task: {
  title: string;
  reason: string;
  agent?: string;
}): SlackBlock[] {
  return [
    markdownSection(`:rotating_light: *Blocker Alert*\n*${task.title}*`),
    markdownSection(`> ${task.reason}`),
  ];
}

export function dailyDigestBlocks(summary: {
  completed: number;
  inProgress: number;
  blocked: number;
  highlights: string[];
}): SlackBlock[] {
  const blocks: SlackBlock[] = [
    markdownSection(':chart_with_upwards_trend: *Daily Digest*'),
    markdownSection(
      [
        `:white_check_mark: ${summary.completed} completed`,
        `:hourglass: ${summary.inProgress} in progress`,
        `:no_entry: ${summary.blocked} blocked`,
      ].join('  |  '),
    ),
  ];

  if (summary.highlights.length > 0) {
    blocks.push(divider());
    blocks.push(
      markdownSection('*Highlights*\n' + summary.highlights.map((h) => `• ${h}`).join('\n')),
    );
  }

  return blocks;
}

// ── Conversation context helpers ────────────────────────────────────────────

const MAX_CONTEXT_MESSAGES = 10;

/**
 * Load conversation context for a thread, limited to the last N messages.
 */
export async function loadConversationContext(
  workspaceId: string,
  threadTs: string,
): Promise<{ role: string; content: string; agent?: string }[]> {
  const supabase = createServiceClient();

  const { data } = await supabase
    .from('slack_conversations')
    .select('messages')
    .eq('workspace_id', workspaceId)
    .eq('thread_ts', threadTs)
    .maybeSingle();

  if (!data?.messages || !Array.isArray(data.messages)) return [];

  // Return last N messages as context window
  return data.messages.slice(-MAX_CONTEXT_MESSAGES);
}

/**
 * Archive conversations that have been inactive for more than the specified hours.
 */
export async function archiveStaleConversations(olderThanHours = 24) {
  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();

  const { count } = await supabase.from('slack_conversations').delete().lt('last_activity', cutoff);

  return count ?? 0;
}
