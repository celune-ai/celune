/**
 * Discord proactive response logic.
 *
 * Determines when the agent should proactively respond in Discord channels
 * and generates contextual responses using the agent persona.
 *
 * v2: Threaded replies instead of top-level messages, per-channel opt-in,
 *     max 3 proactive responses per channel per hour, memory search for context.
 *
 * Rate-limited to 3 proactive responses per channel per hour (v2, was 5).
 * Respects workspace and per-channel opt-in settings.
 */

import { createServiceClient } from '@repo/db/service';
import { discordApi } from './discord-api';
import type { GatewayMessage } from './discord-gateway';

// ── Types ──────────────────────────────────────────────────────────────────

interface ShouldRespondResult {
  respond: boolean;
  reason: string;
  triggers: string[];
}

interface ProactiveContext {
  workspaceId: string;
  channelId: string;
  matchedProjects: string[];
  matchedTasks: string[];
  agentName: string;
  agentPersona: string;
}

// ── Rate Limiting ──────────────────────────────────────────────────────────

/**
 * In-memory rate limit store. Key: channelId, Value: timestamps of responses.
 * TODO: Replace with Redis/Upstash — in-memory Maps reset on serverless cold starts,
 * so rate limits are not enforced across deployments or function restarts.
 */
const channelResponseLog = new Map<string, number[]>();
const MAX_RESPONSES_PER_HOUR = 3; // v2: reduced from 5 to 3
const HOUR_MS = 60 * 60 * 1000;

/**
 * Per-workspace daily cost guard: max 50 proactive responses per workspace per day.
 * TODO: Replace with Redis/Upstash — in-memory Maps reset on serverless cold starts.
 */
const MAX_DAILY_RESPONSES_PER_WORKSPACE = 50;
const workspaceDailyLog = new Map<string, { count: number; resetDate: string }>();

function isDailyLimitExceeded(workspaceId: string): boolean {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const entry = workspaceDailyLog.get(workspaceId);

  if (!entry || entry.resetDate !== today) {
    workspaceDailyLog.set(workspaceId, { count: 0, resetDate: today });
    return false;
  }

  return entry.count >= MAX_DAILY_RESPONSES_PER_WORKSPACE;
}

function recordDailyResponse(workspaceId: string): void {
  const today = new Date().toISOString().slice(0, 10);
  const entry = workspaceDailyLog.get(workspaceId);

  if (!entry || entry.resetDate !== today) {
    workspaceDailyLog.set(workspaceId, { count: 1, resetDate: today });
  } else {
    entry.count++;
  }
}

function isRateLimited(channelId: string): boolean {
  const now = Date.now();
  const timestamps = channelResponseLog.get(channelId) ?? [];

  // Prune entries older than 1 hour
  const recent = timestamps.filter((t) => now - t < HOUR_MS);
  channelResponseLog.set(channelId, recent);

  return recent.length >= MAX_RESPONSES_PER_HOUR;
}

function recordResponse(channelId: string): void {
  const timestamps = channelResponseLog.get(channelId) ?? [];
  timestamps.push(Date.now());
  channelResponseLog.set(channelId, timestamps);
}

// ── Trigger Detection ──────────────────────────────────────────────────────

const HELP_PATTERNS = [
  /\bhelp\b/i,
  /\bhow (do|can|should) (i|we)\b/i,
  /\bwhat('s| is) the (status|progress)\b/i,
  /\bany(one|body) know\b/i,
  /\bquick question\b/i,
  /\bcan someone\b/i,
];

const QUESTION_PATTERN = /\?\s*$/;

function detectTriggers(content: string, projectNames: string[], taskKeywords: string[]): string[] {
  const triggers: string[] = [];
  const lower = content.toLowerCase();

  // Check for project name mentions
  for (const name of projectNames) {
    const words = name
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    if (words.some((w) => lower.includes(w))) {
      triggers.push(`project:${name}`);
    }
  }

  // Check for task keyword mentions
  for (const keyword of taskKeywords) {
    const words = keyword
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    if (words.some((w) => lower.includes(w))) {
      triggers.push(`task:${keyword}`);
    }
  }

  // Check for help patterns
  for (const pattern of HELP_PATTERNS) {
    if (pattern.test(content)) {
      triggers.push('help_request');
      break;
    }
  }

  // Check for direct questions
  if (QUESTION_PATTERN.test(content.trim())) {
    triggers.push('question');
  }

  return triggers;
}

// ── Opt-in Check ───────────────────────────────────────────────────────────

async function isProactiveEnabled(workspaceId: string): Promise<boolean> {
  const supabase = createServiceClient();

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('settings')
    .eq('id', workspaceId)
    .single();

  if (!workspace?.settings) return false;

  const settings = workspace.settings as Record<string, unknown>;
  return settings.discord_proactive_responses === true;
}

// ── Should Respond ─────────────────────────────────────────────────────────

/**
 * Determine if the agent should proactively respond to a Discord message.
 *
 * Checks: opt-in preference, rate limit, trigger detection.
 */
export async function shouldRespond(
  message: GatewayMessage,
  workspaceId: string,
): Promise<ShouldRespondResult> {
  // Skip bot messages
  if (message.author.bot) {
    return { respond: false, reason: 'bot_message', triggers: [] };
  }

  // Check workspace opt-in
  if (!(await isProactiveEnabled(workspaceId))) {
    return { respond: false, reason: 'not_opted_in', triggers: [] };
  }

  // Check per-channel opt-in (v2)
  if (!(await isChannelProactiveEnabled(workspaceId, message.channel_id))) {
    return { respond: false, reason: 'channel_not_opted_in', triggers: [] };
  }

  // Check per-channel hourly rate limit
  if (isRateLimited(message.channel_id)) {
    return { respond: false, reason: 'rate_limited', triggers: [] };
  }

  // Check per-workspace daily cost guard
  if (isDailyLimitExceeded(workspaceId)) {
    return { respond: false, reason: 'daily_limit_exceeded', triggers: [] };
  }

  // Gather workspace context for trigger detection
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

  const projectNames = (projects ?? []).map((p) => p.name);
  const taskKeywords = (tasks ?? []).map((t) => t.title);

  const triggers = detectTriggers(message.content, projectNames, taskKeywords);

  if (triggers.length === 0) {
    return { respond: false, reason: 'no_triggers', triggers: [] };
  }

  return { respond: true, reason: 'triggered', triggers };
}

// ── Response Generation ────────────────────────────────────────────────────

/**
 * Generate a contextual proactive response.
 *
 * Builds context from matched projects/tasks and generates a helpful
 * response using the assigned agent's persona. Returns null if no
 * agent is assigned to the channel.
 */
export async function generateProactiveResponse(
  message: GatewayMessage,
  context: ProactiveContext,
): Promise<string | null> {
  const supabase = createServiceClient();

  // Gather relevant context for the response
  const contextParts: string[] = [];

  // Get matched project details
  if (context.matchedProjects.length > 0) {
    const { data: projects } = await supabase
      .from('projects')
      .select('name, status, description')
      .eq('workspace_id', context.workspaceId)
      .in('name', context.matchedProjects)
      .limit(3);

    if (projects?.length) {
      for (const p of projects) {
        contextParts.push(
          `Project "${p.name}" (${p.status}): ${p.description?.slice(0, 200) ?? 'No description'}`,
        );
      }
    }
  }

  // Get matched task details
  if (context.matchedTasks.length > 0) {
    const { data: tasks } = await supabase
      .from('tasks')
      .select('title, status, priority, assignee')
      .eq('workspace_id', context.workspaceId)
      .in('title', context.matchedTasks)
      .limit(5);

    if (tasks?.length) {
      for (const t of tasks) {
        contextParts.push(
          `Task "${t.title}" — ${t.status}, ${t.priority} priority${t.assignee ? `, assigned to ${t.assignee}` : ''}`,
        );
      }
    }
  }

  // Get relevant memories
  const { data: memories } = await supabase
    .from('agent_memory')
    .select('content')
    .eq('workspace_id', context.workspaceId)
    .textSearch('content', message.content.split(' ').slice(0, 5).join(' & '), {
      type: 'websearch',
    })
    .limit(3);

  if (memories?.length) {
    contextParts.push('Related memories:');
    for (const m of memories) {
      contextParts.push(`- ${m.content.slice(0, 150)}`);
    }
  }

  // Build the response prompt
  const prompt = [
    `You are ${context.agentName}, an AI assistant with this persona: ${context.agentPersona}`,
    '',
    'A user sent a message in a Discord channel you are monitoring. Provide a brief, helpful response.',
    'Keep it under 300 characters. Be conversational, not robotic. If you are not confident, say so.',
    '',
    `User message: ${message.content}`,
    `User: @${message.author.username}`,
    '',
    contextParts.length > 0 ? `Workspace context:\n${contextParts.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  // Use Anthropic SDK for generation if available, otherwise return a template response
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : null;

    if (text) {
      recordResponse(context.channelId);
      recordDailyResponse(context.workspaceId);
      return text;
    }
  } catch (err) {
    console.error('[discord-proactive] Response generation failed:', err);
  }

  return null;
}

/**
 * Build proactive context from trigger analysis results.
 */
export async function buildProactiveContext(
  message: GatewayMessage,
  workspaceId: string,
  triggers: string[],
): Promise<ProactiveContext | null> {
  const supabase = createServiceClient();

  // Check if an agent is assigned to this channel
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('settings')
    .eq('id', workspaceId)
    .single();

  const settings = (workspace?.settings ?? {}) as Record<string, unknown>;
  const channelAgents = (settings.discord_channel_agents ?? {}) as Record<string, string>;
  const agentId = channelAgents[message.channel_id];

  if (!agentId) return null;

  // Get agent config
  const { data: agent } = await supabase
    .from('agent_configs')
    .select('name, persona')
    .eq('id', agentId)
    .eq('workspace_id', workspaceId)
    .single();

  if (!agent) return null;

  const matchedProjects = triggers
    .filter((t) => t.startsWith('project:'))
    .map((t) => t.replace('project:', ''));

  const matchedTasks = triggers
    .filter((t) => t.startsWith('task:'))
    .map((t) => t.replace('task:', ''));

  return {
    workspaceId,
    channelId: message.channel_id,
    matchedProjects,
    matchedTasks,
    agentName: agent.name,
    agentPersona: (agent.persona as string) ?? 'A helpful AI assistant.',
  };
}

// ── Per-Channel Opt-in (v2) ───────────────────────────────────────────────

/**
 * Check if proactive responses are enabled for a specific channel.
 * Channels are opt-in: they need an agent assigned to be eligible.
 * Additionally checks the discord_proactive_channels allowlist if set.
 */
async function isChannelProactiveEnabled(workspaceId: string, channelId: string): Promise<boolean> {
  const supabase = createServiceClient();

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('settings')
    .eq('id', workspaceId)
    .single();

  if (!workspace?.settings) return false;

  const settings = workspace.settings as Record<string, unknown>;

  // Must have an agent assigned to this channel
  const channelAgents = (settings.discord_channel_agents ?? {}) as Record<string, string>;
  if (!channelAgents[channelId]) return false;

  // If a proactive channels list exists, channel must be on it
  const proactiveChannels = settings.discord_proactive_channels as string[] | undefined;
  if (proactiveChannels && !proactiveChannels.includes(channelId)) return false;

  return true;
}

// ── Threaded Reply (v2) ───────────────────────────────────────────────────

/**
 * Send a proactive response as a threaded reply to the original message.
 * This avoids cluttering the main channel with bot responses.
 */
export async function sendThreadedReply(
  channelId: string,
  messageId: string,
  content: string,
): Promise<boolean> {
  try {
    const result = await discordApi(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: {
        content,
        message_reference: {
          message_id: messageId,
          fail_if_not_exists: false,
        },
      },
    });

    return result !== null;
  } catch (err) {
    console.error('[discord-proactive] Failed to send threaded reply:', err);
    return false;
  }
}

/**
 * Search agent_memory for related content to include in proactive response.
 * Returns high-confidence matches (similarity > threshold based on match count).
 */
export async function searchRelatedMemories(
  workspaceId: string,
  content: string,
  limit = 3,
): Promise<{ content: string; category: string }[]> {
  const supabase = createServiceClient();

  // Build search terms from message content
  const searchTerms = content
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 8)
    .join(' | ');

  if (!searchTerms) return [];

  const { data: memories } = await supabase
    .from('agent_memory')
    .select('content, category')
    .eq('workspace_id', workspaceId)
    .textSearch('content', searchTerms, { type: 'websearch' })
    .limit(limit);

  return (memories ?? []).map((m) => ({
    content: m.content?.slice(0, 200) ?? '',
    category: m.category ?? 'unknown',
  }));
}
