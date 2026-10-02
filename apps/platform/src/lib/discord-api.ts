/**
 * Discord REST API client and embed builders.
 *
 * Provides helpers for:
 * - Sending followup messages (for deferred responses)
 * - Building rich embeds for tasks, projects, and memory entries
 * - Managing threads
 */
import { APP_URL } from '@/lib/branding';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const BOT_TOKEN = () => process.env.DISCORD_BOT_TOKEN;
const APP_ID = () => process.env.DISCORD_APPLICATION_ID;

// ── Types ───────────────────────────────────────────────────────────────────

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

export interface DiscordComponent {
  type: number;
  components?: DiscordComponent[];
  style?: number;
  label?: string;
  custom_id?: string;
  url?: string;
  emoji?: { name: string };
  disabled?: boolean;
}

// ── Colors ──────────────────────────────────────────────────────────────────

export const COLORS = {
  brand: 0x5bc586, // Celune green
  success: 0x57f287,
  warning: 0xfee75c,
  error: 0xed4245,
  info: 0x5865f2,
  muted: 0x99aab5,
} as const;

// ── API helpers ─────────────────────────────────────────────────────────────

export async function discordApi(
  path: string,
  opts?: { method?: string; body?: unknown; token?: string },
): Promise<unknown> {
  const token = opts?.token ?? BOT_TOKEN();
  if (!token) throw new Error('DISCORD_BOT_TOKEN not configured');

  const res = await fetch(`${DISCORD_API_BASE}${path}`, {
    method: opts?.method ?? 'GET',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    ...(opts?.body ? { body: JSON.stringify(opts.body) } : {}),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => 'Unknown error');
    console.error(`[discord-api] ${opts?.method ?? 'GET'} ${path} failed:`, res.status, err);
    return null;
  }

  if (res.status === 204) return null;
  return res.json();
}

/**
 * Send a followup message to a deferred interaction.
 */
export async function createFollowupMessage(
  interactionToken: string,
  content: string,
  opts?: { embeds?: DiscordEmbed[]; components?: DiscordComponent[]; ephemeral?: boolean },
) {
  return discordApi(`/webhooks/${APP_ID()}/${interactionToken}`, {
    method: 'POST',
    body: {
      content,
      ...(opts?.embeds ? { embeds: opts.embeds } : {}),
      ...(opts?.components ? { components: opts.components } : {}),
      ...(opts?.ephemeral ? { flags: 64 } : {}),
    },
  });
}

/**
 * Edit the original interaction response.
 */
export async function editOriginalResponse(
  interactionToken: string,
  content: string,
  opts?: { embeds?: DiscordEmbed[]; components?: DiscordComponent[] },
) {
  return discordApi(`/webhooks/${APP_ID()}/${interactionToken}/messages/@original`, {
    method: 'PATCH',
    body: {
      content,
      ...(opts?.embeds ? { embeds: opts.embeds } : {}),
      ...(opts?.components ? { components: opts.components } : {}),
    },
  });
}

// ── Embed builders ──────────────────────────────────────────────────────────

export function taskEmbed(task: {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee?: string | null;
  description?: string | null;
  workspaceSlug?: string;
}): DiscordEmbed {
  const statusEmoji: Record<string, string> = {
    inbox: '📥',
    assigned: '📋',
    in_progress: '🔧',
    planning: '📐',
    done: '✅',
    blocked: '🚫',
    backlog: '📦',
  };

  const priorityEmoji: Record<string, string> = {
    urgent: '🔴',
    high: '🟠',
    normal: '🔵',
    low: '⚪',
  };

  return {
    title: `${statusEmoji[task.status] ?? '📋'} ${task.title}`,
    description: task.description?.slice(0, 200) ?? undefined,
    url: task.workspaceSlug ? `${APP_URL}/${task.workspaceSlug}/tasks?task=${task.id}` : undefined,
    color: task.status === 'done' ? COLORS.success : COLORS.brand,
    fields: [
      { name: 'Status', value: task.status, inline: true },
      {
        name: 'Priority',
        value: `${priorityEmoji[task.priority] ?? ''} ${task.priority}`,
        inline: true,
      },
      ...(task.assignee ? [{ name: 'Assignee', value: task.assignee, inline: true }] : []),
    ],
    footer: { text: `ID: ${task.id.slice(0, 8)}` },
  };
}

export function projectEmbed(project: {
  id: string;
  name: string;
  status: string;
  totalTasks: number;
  doneTasks: number;
  description?: string | null;
  workspaceSlug?: string;
}): DiscordEmbed {
  const pct =
    project.totalTasks > 0 ? Math.round((project.doneTasks / project.totalTasks) * 100) : 0;

  const progressBar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));

  return {
    title: `📊 ${project.name}`,
    description: project.description?.slice(0, 200) ?? undefined,
    url: project.workspaceSlug
      ? `${APP_URL}/${project.workspaceSlug}/projects/${project.id}`
      : undefined,
    color: project.status === 'completed' ? COLORS.success : COLORS.brand,
    fields: [
      { name: 'Status', value: project.status, inline: true },
      {
        name: 'Progress',
        value: `${progressBar} ${pct}% (${project.doneTasks}/${project.totalTasks})`,
        inline: false,
      },
    ],
  };
}

export function memoryEmbed(memory: {
  id: string;
  content: string;
  category?: string | null;
  relevance?: number;
}): DiscordEmbed {
  return {
    title: '🧠 Memory Entry',
    description: memory.content.slice(0, 1000),
    color: COLORS.info,
    fields: [
      ...(memory.category ? [{ name: 'Category', value: memory.category, inline: true }] : []),
      ...(memory.relevance !== undefined
        ? [{ name: 'Relevance', value: `${Math.round(memory.relevance * 100)}%`, inline: true }]
        : []),
    ],
    footer: { text: `ID: ${memory.id.slice(0, 8)}` },
  };
}

// ── Button builders ─────────────────────────────────────────────────────────

export function actionRow(...buttons: DiscordComponent[]): DiscordComponent {
  return { type: 1, components: buttons };
}

export function linkButton(label: string, url: string): DiscordComponent {
  return { type: 2, style: 5, label, url };
}

export function primaryButton(
  label: string,
  customId: string,
  opts?: { emoji?: string; disabled?: boolean },
): DiscordComponent {
  return {
    type: 2,
    style: 1,
    label,
    custom_id: customId,
    ...(opts?.emoji ? { emoji: { name: opts.emoji } } : {}),
    ...(opts?.disabled ? { disabled: true } : {}),
  };
}

export function dangerButton(label: string, customId: string): DiscordComponent {
  return { type: 2, style: 4, label, custom_id: customId };
}

// ── Command registration ───────────────────────────────────────────────────

/**
 * Bulk-overwrite global application commands.
 * Uses PUT /applications/{app_id}/commands which atomically replaces all commands.
 */
export async function registerCommands(commands: unknown[]): Promise<unknown> {
  return discordApi(`/applications/${APP_ID()}/commands`, {
    method: 'PUT',
    body: commands,
  });
}

// ── Guild helpers ──────────────────────────────────────────────────────────

/**
 * Fetch a guild member's info (roles, nickname, etc.)
 */
export async function getGuildMember(
  guildId: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  return discordApi(`/guilds/${guildId}/members/${userId}`) as Promise<Record<
    string,
    unknown
  > | null>;
}
