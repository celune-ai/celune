/**
 * Discord message relevance filter.
 *
 * Filters incoming Discord messages to only process relevant ones.
 * Used by the gateway-events handler before memory ingestion and proactive responses.
 *
 * Checks:
 * - @mention detection (always relevant)
 * - Keyword matching against workspace project/task names
 * - Channel allowlist (from workspace settings)
 * - Rate limiting: max 100 messages processed per minute per workspace
 * - Ignore: bot messages, system messages, very short messages (<5 chars)
 */

import { createServiceClient } from '@repo/db/service';
import type { GatewayMessage } from './discord-gateway';

// ── Types ──────────────────────────────────────────────────────────────────

export interface RelevanceResult {
  relevant: boolean;
  reason: string;
  /** Matched keywords/project names for context */
  matchedKeywords: string[];
  /** Whether this was an @mention of the bot */
  isMention: boolean;
  /** Channel allowlist status */
  channelAllowed: boolean;
}

// ── Rate Limiting ──────────────────────────────────────────────────────────

const MAX_MESSAGES_PER_MINUTE = 100;
const MINUTE_MS = 60 * 1000;

/**
 * Per-workspace message processing rate limiter.
 * Key: workspaceId, Value: timestamps of processed messages.
 */
const workspaceMessageLog = new Map<string, number[]>();

function isWorkspaceRateLimited(workspaceId: string): boolean {
  const now = Date.now();
  const timestamps = workspaceMessageLog.get(workspaceId) ?? [];
  const recent = timestamps.filter((t) => now - t < MINUTE_MS);
  workspaceMessageLog.set(workspaceId, recent);
  return recent.length >= MAX_MESSAGES_PER_MINUTE;
}

function recordWorkspaceMessage(workspaceId: string): void {
  const timestamps = workspaceMessageLog.get(workspaceId) ?? [];
  timestamps.push(Date.now());
  workspaceMessageLog.set(workspaceId, timestamps);
}

// ── Rate Limit Logging ─────────────────────────────────────────────────────

export interface RateLimitEvent {
  timestamp: string;
  workspaceId: string;
  channelId: string;
  type: 'workspace_message_limit';
}

const rateLimitLog: RateLimitEvent[] = [];
const MAX_RATE_LIMIT_LOG = 1000;

export function logRateLimitHit(workspaceId: string, channelId: string): void {
  const event: RateLimitEvent = {
    timestamp: new Date().toISOString(),
    workspaceId,
    channelId,
    type: 'workspace_message_limit',
  };

  rateLimitLog.push(event);
  if (rateLimitLog.length > MAX_RATE_LIMIT_LOG) {
    rateLimitLog.splice(0, rateLimitLog.length - MAX_RATE_LIMIT_LOG);
  }

  console.warn(`[discord-relevance] Rate limit hit: workspace=${workspaceId} channel=${channelId}`);
}

export function getRecentRateLimitEvents(limit = 50): RateLimitEvent[] {
  return rateLimitLog.slice(-limit);
}

// ── Filters ────────────────────────────────────────────────────────────────

const MIN_MESSAGE_LENGTH = 5;
const SYSTEM_MESSAGE_TYPES = [6, 7, 8, 9, 10, 11, 12]; // Discord system message types

/**
 * Quick pre-filter: returns a skip reason or null if the message passes.
 */
function preFilter(message: GatewayMessage): string | null {
  // Skip bot messages
  if (message.author.bot) return 'bot_message';

  // Skip very short messages
  if (message.content.length < MIN_MESSAGE_LENGTH) return 'too_short';

  // Skip system messages (if type field is present)
  const msgType = (message as unknown as Record<string, unknown>).type as number | undefined;
  if (msgType !== undefined && SYSTEM_MESSAGE_TYPES.includes(msgType)) return 'system_message';

  return null;
}

// ── @Mention Detection ─────────────────────────────────────────────────────

function isBotMentioned(message: GatewayMessage, botUserId?: string): boolean {
  if (!botUserId) return false;
  return message.mentions.some((m) => m.id === botUserId);
}

// ── Channel Allowlist ──────────────────────────────────────────────────────

async function getChannelAllowlist(workspaceId: string): Promise<string[] | null> {
  const supabase = createServiceClient();

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('settings')
    .eq('id', workspaceId)
    .single();

  if (!workspace?.settings) return null;

  const settings = workspace.settings as Record<string, unknown>;
  const allowlist = settings.discord_channel_allowlist as string[] | undefined;

  // null means "all channels allowed" (no restriction)
  return allowlist ?? null;
}

// ── Keyword Matching ───────────────────────────────────────────────────────

async function getWorkspaceKeywords(
  workspaceId: string,
): Promise<{ projects: string[]; tasks: string[] }> {
  const supabase = createServiceClient();

  const [{ data: projects }, { data: tasks }] = await Promise.all([
    supabase
      .from('projects')
      .select('name')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .limit(50),
    supabase
      .from('tasks')
      .select('title')
      .eq('workspace_id', workspaceId)
      .in('status', ['in_progress', 'assigned', 'planning'])
      .limit(100),
  ]);

  return {
    projects: (projects ?? []).map((p) => p.name.toLowerCase()),
    tasks: (tasks ?? []).map((t) => t.title.toLowerCase()),
  };
}

function matchKeywords(
  content: string,
  keywords: { projects: string[]; tasks: string[] },
): string[] {
  const lower = content.toLowerCase();
  const matched: string[] = [];

  for (const name of keywords.projects) {
    const words = name.split(/\s+/).filter((w) => w.length > 3);
    if (words.some((w) => lower.includes(w))) {
      matched.push(`project:${name}`);
    }
  }

  for (const title of keywords.tasks) {
    const words = title.split(/\s+/).filter((w) => w.length > 3);
    if (words.some((w) => lower.includes(w))) {
      matched.push(`task:${title}`);
    }
  }

  return matched;
}

// ── Main Filter ────────────────────────────────────────────────────────────

/**
 * Determine if a Discord message is relevant and should be processed.
 *
 * @param message — The Discord gateway message
 * @param workspaceId — The resolved workspace ID
 * @param botUserId — The bot's own Discord user ID (for @mention detection)
 */
export async function filterMessage(
  message: GatewayMessage,
  workspaceId: string,
  botUserId?: string,
): Promise<RelevanceResult> {
  // Step 1: Pre-filter (bot, short, system)
  const skipReason = preFilter(message);
  if (skipReason) {
    return {
      relevant: false,
      reason: skipReason,
      matchedKeywords: [],
      isMention: false,
      channelAllowed: true,
    };
  }

  // Step 2: Rate limit check
  if (isWorkspaceRateLimited(workspaceId)) {
    logRateLimitHit(workspaceId, message.channel_id);
    return {
      relevant: false,
      reason: 'rate_limited',
      matchedKeywords: [],
      isMention: false,
      channelAllowed: true,
    };
  }

  // Step 3: Channel allowlist check
  const allowlist = await getChannelAllowlist(workspaceId);
  const channelAllowed = allowlist === null || allowlist.includes(message.channel_id);

  if (!channelAllowed) {
    return {
      relevant: false,
      reason: 'channel_not_allowed',
      matchedKeywords: [],
      isMention: false,
      channelAllowed: false,
    };
  }

  // Step 4: @mention detection (always relevant)
  const isMention = isBotMentioned(message, botUserId);
  if (isMention) {
    recordWorkspaceMessage(workspaceId);
    return {
      relevant: true,
      reason: 'bot_mentioned',
      matchedKeywords: [],
      isMention: true,
      channelAllowed: true,
    };
  }

  // Step 5: Keyword matching
  const keywords = await getWorkspaceKeywords(workspaceId);
  const matchedKeywords = matchKeywords(message.content, keywords);

  if (matchedKeywords.length > 0) {
    recordWorkspaceMessage(workspaceId);
    return {
      relevant: true,
      reason: 'keyword_match',
      matchedKeywords,
      isMention: false,
      channelAllowed: true,
    };
  }

  return {
    relevant: false,
    reason: 'not_relevant',
    matchedKeywords: [],
    isMention: false,
    channelAllowed: true,
  };
}
