/**
 * apps/platform/src/lib/slack-api.ts
 *
 * Slack Web API client for making authenticated calls using bot tokens.
 * Used by Events API handlers, Home Tab publisher, and message senders.
 */

// ── Block Kit types ─────────────────────────────────────────────────────────

export interface SlackBlock {
  type: string;
  block_id?: string;
  text?: { type: string; text: string; emoji?: boolean };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  elements?: any[];
  fields?: { type: string; text: string }[];
  accessory?: SlackElement;
  label?: { type: string; text: string; emoji?: boolean };
  dispatch_action?: boolean;
}

export interface SlackElement {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  action_id?: string;
  url?: string;
  value?: string;
  style?: string;
  options?: SlackOption[];
}

export interface SlackOption {
  text: { type: string; text: string };
  value: string;
}

// ── Block Kit builder helpers ───────────────────────────────────────────────

export function headerBlock(text: string): SlackBlock {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } };
}

export function markdownSection(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

export function fieldsSection(fields: string[]): SlackBlock {
  return {
    type: 'section',
    fields: fields.map((f) => ({ type: 'mrkdwn', text: f })),
  };
}

export function divider(): SlackBlock {
  return { type: 'divider' };
}

export function actionsBlock(elements: SlackElement[], blockId?: string): SlackBlock {
  return { type: 'actions', elements, block_id: blockId };
}

export function button(
  text: string,
  actionId: string,
  opts?: { url?: string; value?: string; style?: 'primary' | 'danger' },
): SlackElement {
  return {
    type: 'button',
    text: { type: 'plain_text', text, emoji: true },
    action_id: actionId,
    ...(opts?.url ? { url: opts.url } : {}),
    ...(opts?.value ? { value: opts.value } : {}),
    ...(opts?.style ? { style: opts.style } : {}),
  };
}

export function contextBlock(elements: { type: string; text: string }[]): SlackBlock {
  return { type: 'context', elements };
}

// ── Slack Web API calls ─────────────────────────────────────────────────────

const SLACK_API_BASE = 'https://slack.com/api';

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

async function slackApiCall(
  method: string,
  botToken: string,
  body: Record<string, unknown>,
): Promise<SlackApiResponse> {
  const res = await fetch(`${SLACK_API_BASE}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as SlackApiResponse;

  if (!data.ok) {
    console.error(`[slack-api] ${method} failed:`, data.error);
  }

  return data;
}

/**
 * Post a message to a Slack channel or DM.
 */
export async function chatPostMessage(
  botToken: string,
  channel: string,
  text: string,
  opts?: {
    blocks?: SlackBlock[];
    thread_ts?: string;
    reply_broadcast?: boolean;
    /** Custom bot display name (requires chat:write.customize scope) */
    username?: string;
    /** Custom bot icon URL (requires chat:write.customize scope) */
    icon_url?: string;
  },
) {
  return slackApiCall('chat.postMessage', botToken, {
    channel,
    text,
    ...(opts?.blocks ? { blocks: opts.blocks } : {}),
    ...(opts?.thread_ts ? { thread_ts: opts.thread_ts } : {}),
    ...(opts?.reply_broadcast ? { reply_broadcast: opts.reply_broadcast } : {}),
    ...(opts?.username ? { username: opts.username } : {}),
    ...(opts?.icon_url ? { icon_url: opts.icon_url } : {}),
  });
}

/**
 * Publish or update a user's Home Tab view.
 */
export async function viewsPublish(botToken: string, userId: string, blocks: SlackBlock[]) {
  return slackApiCall('views.publish', botToken, {
    user_id: userId,
    view: {
      type: 'home',
      blocks,
    },
  });
}

/**
 * Get user info from Slack.
 */
export async function usersInfo(botToken: string, userId: string) {
  return slackApiCall('users.info', botToken, { user: userId });
}

// ── Assistant API (Agents & Assistants) ──────────────────────────────────────

/**
 * Set suggested prompts for an assistant thread.
 * These appear as clickable buttons in the agent sidebar.
 */
export async function assistantSetSuggestedPrompts(
  botToken: string,
  channelId: string,
  threadTs: string,
  prompts: { title: string; message: string }[],
) {
  return slackApiCall('assistant.threads.setSuggestedPrompts', botToken, {
    channel_id: channelId,
    thread_ts: threadTs,
    prompts: prompts.slice(0, 4), // Max 4 prompts
  });
}

/**
 * Set the assistant status message shown while generating a response.
 */
export async function assistantSetStatus(
  botToken: string,
  channelId: string,
  threadTs: string,
  status: string,
) {
  return slackApiCall('assistant.threads.setStatus', botToken, {
    channel_id: channelId,
    thread_ts: threadTs,
    status,
  });
}

/**
 * Fetch message history from a channel.
 * Used by reaction handlers to read the reacted-to message.
 */
export async function conversationsHistory(
  botToken: string,
  channel: string,
  opts?: {
    latest?: string;
    oldest?: string;
    inclusive?: boolean;
    limit?: number;
  },
) {
  return slackApiCall('conversations.history', botToken, {
    channel,
    ...(opts?.latest ? { latest: opts.latest } : {}),
    ...(opts?.oldest ? { oldest: opts.oldest } : {}),
    ...(opts?.inclusive !== undefined ? { inclusive: opts.inclusive } : {}),
    ...(opts?.limit ? { limit: opts.limit } : {}),
  });
}

/**
 * Fetch threaded replies for a specific message.
 * Uses conversations.replies to get the full thread, not channel history.
 */
export async function conversationsReplies(
  botToken: string,
  channel: string,
  ts: string,
  opts?: {
    latest?: string;
    oldest?: string;
    inclusive?: boolean;
    limit?: number;
  },
) {
  return slackApiCall('conversations.replies', botToken, {
    channel,
    ts,
    ...(opts?.latest ? { latest: opts.latest } : {}),
    ...(opts?.oldest ? { oldest: opts.oldest } : {}),
    ...(opts?.inclusive !== undefined ? { inclusive: opts.inclusive } : {}),
    ...(opts?.limit ? { limit: opts.limit } : {}),
  });
}

/**
 * Unfurl links in a message with rich preview content.
 * Used by link_shared handler to show Celune resource previews.
 */
export async function chatUnfurl(
  botToken: string,
  channel: string,
  ts: string,
  unfurls: Record<string, unknown>,
) {
  return slackApiCall('chat.unfurl', botToken, {
    channel,
    ts,
    unfurls,
  });
}

/**
 * Open a DM conversation with a Slack user.
 * Returns the DM channel ID, or null on failure.
 */
export async function conversationsOpen(botToken: string, userId: string): Promise<string | null> {
  const res = await slackApiCall('conversations.open', botToken, { users: userId });
  return res.ok ? ((res.channel?.id as string) ?? null) : null;
}

/**
 * Set the title of an assistant thread.
 */
export async function assistantSetTitle(
  botToken: string,
  channelId: string,
  threadTs: string,
  title: string,
) {
  return slackApiCall('assistant.threads.setTitle', botToken, {
    channel_id: channelId,
    thread_ts: threadTs,
    title,
  });
}
