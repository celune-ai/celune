/**
 * apps/platform/src/lib/slack-notifications.ts
 *
 * Notification dispatch service for Slack. Sends formatted Block Kit messages
 * for task assignments, deadline warnings, task completions, and project updates.
 *
 * Rate limited: max 10 notifications per user per hour (in-memory).
 * Respects workspace notification_preferences before sending.
 */

import { createServiceClient } from '@repo/db/service';
import { decryptBotToken } from '@repo/notifications/decrypt-webhook';
import type { BotTokenFields } from '@repo/notifications/decrypt-webhook';
import {
  type SlackBlock,
  chatPostMessage,
  conversationsOpen,
  headerBlock,
  markdownSection,
  fieldsSection,
  divider,
  actionsBlock,
  button,
  contextBlock,
} from './slack-api';
import { APP_URL } from '@/lib/branding';

// ── Types ───────────────────────────────────────────────────────────────────

interface TaskPayload {
  id: string;
  title: string;
  status: string;
  priority?: string | null;
  assignee?: string | null;
  project_id?: string | null;
  due_date?: string | null;
  description?: string | null;
  workspace_id: string;
}

interface ProjectPayload {
  id: string;
  name: string;
  status: string;
  workspace_id: string;
  progress?: number | null;
  task_count?: number | null;
  completed_count?: number | null;
}

// ── Rate limiting (in-memory) ───────────────────────────────────────────────

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Map of `userId -> { timestamps[] }`.
 * TODO: Replace with Redis/Upstash — in-memory Maps reset on serverless cold starts,
 * so rate limits are not enforced across deployments or function restarts.
 */
const rateLimitMap = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(userId) ?? [];

  // Prune expired entries
  const valid = timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);

  if (valid.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(userId, valid);
    return true;
  }

  valid.push(now);
  rateLimitMap.set(userId, valid);

  // Periodic cleanup: remove stale users
  if (rateLimitMap.size > 1000) {
    for (const [key, vals] of rateLimitMap) {
      const active = vals.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
      if (active.length === 0) rateLimitMap.delete(key);
      else rateLimitMap.set(key, active);
    }
  }

  return false;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const PRIORITY_EMOJI: Record<string, string> = {
  critical: ':red_circle:',
  high: ':orange_circle:',
  medium: ':large_yellow_circle:',
  low: ':white_circle:',
};

const STATUS_EMOJI: Record<string, string> = {
  inbox: ':inbox_tray:',
  planned: ':calendar:',
  assigned: ':dart:',
  in_progress: ':hourglass:',
  blocked: ':no_entry:',
  review: ':eyes:',
  done: ':white_check_mark:',
};

/**
 * Resolve Slack connection + bot token for a workspace.
 */
async function resolveSlackConnection(workspaceId: string) {
  const supabase = createServiceClient();
  const { data: conn } = await supabase
    .from('slack_connections')
    .select('slack_team_id, bot_token_encrypted, bot_token_iv, installation_type, slack_channel_id')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .maybeSingle();

  if (!conn) return null;

  const botToken = decryptBotToken(conn as BotTokenFields);
  if (!botToken) return null;

  return { botToken, channelId: conn.slack_channel_id, teamId: conn.slack_team_id };
}

/**
 * Check if a workspace has notifications enabled for a given event type on Slack.
 */
async function isEventEnabled(workspaceId: string, eventType: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('notification_preferences')
    .select('event_types, is_enabled')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'slack')
    .eq('is_enabled', true)
    .limit(10);

  if (!data || data.length === 0) return true; // Default: send if no prefs configured

  // Check if ANY user in this workspace has this event type enabled
  return data.some(
    (pref) => Array.isArray(pref.event_types) && pref.event_types.includes(eventType),
  );
}

/**
 * Build a task link for Block Kit.
 */
function taskLink(task: TaskPayload): string {
  return `<${APP_URL}/${task.workspace_id}/tasks?task=${task.id}|${task.title}>`;
}

// ── Notification dispatchers ────────────────────────────────────────────────

/**
 * DM the assignee when a task is assigned to them.
 */
export async function sendTaskAssignedNotification(
  workspaceId: string,
  task: TaskPayload,
  assigneeSlackId: string,
): Promise<boolean> {
  if (isRateLimited(assigneeSlackId)) {
    console.warn(`[slack-notifications] Rate limited for user ${assigneeSlackId}`);
    return false;
  }

  if (!(await isEventEnabled(workspaceId, 'task.assigned'))) return false;

  const conn = await resolveSlackConnection(workspaceId);
  if (!conn) return false;

  // Open a DM channel with the assignee
  const dmChannel = await conversationsOpen(conn.botToken, assigneeSlackId);
  if (!dmChannel) {
    console.warn(`[slack-notifications] Could not open DM with ${assigneeSlackId}`);
    return false;
  }

  const priorityEmoji = PRIORITY_EMOJI[task.priority ?? 'medium'] ?? ':large_yellow_circle:';

  const blocks: SlackBlock[] = [
    markdownSection(`${priorityEmoji} *New task assigned to you*\n${taskLink(task)}`),
    fieldsSection([
      `*Priority:* ${task.priority ?? 'Medium'}`,
      `*Status:* ${task.status}`,
      ...(task.due_date ? [`*Due:* ${task.due_date}`] : []),
    ]),
  ];

  if (task.description) {
    const truncated =
      task.description.length > 200 ? task.description.slice(0, 200) + '...' : task.description;
    blocks.push(contextBlock([{ type: 'mrkdwn', text: truncated }]));
  }

  blocks.push(
    actionsBlock(
      [
        button('View Task', 'view_task', {
          url: `${APP_URL}/${workspaceId}/tasks?task=${task.id}`,
        }),
        button('View Dashboard', 'view_dashboard', {
          url: `${APP_URL}/${workspaceId}`,
        }),
      ],
      'task_assigned_actions',
    ),
  );

  await chatPostMessage(conn.botToken, dmChannel, `New task assigned: ${task.title}`, { blocks });
  return true;
}

/**
 * Warn about approaching deadlines (24h or 1h before due_date).
 */
export async function sendDeadlineWarning(
  workspaceId: string,
  task: TaskPayload,
  urgency: '24h' | '1h' = '24h',
): Promise<boolean> {
  if (!(await isEventEnabled(workspaceId, 'task.deadline'))) return false;

  const conn = await resolveSlackConnection(workspaceId);
  if (!conn) return false;

  const channel = conn.channelId;
  if (!channel) return false;

  const urgencyEmoji = urgency === '1h' ? ':rotating_light:' : ':warning:';
  const urgencyText =
    urgency === '1h' ? 'due in *less than 1 hour*' : 'due in *less than 24 hours*';

  const blocks: SlackBlock[] = [
    markdownSection(`${urgencyEmoji} *Deadline approaching* — ${taskLink(task)} is ${urgencyText}`),
    fieldsSection([
      `*Assignee:* ${task.assignee ?? 'Unassigned'}`,
      `*Due:* ${task.due_date ?? 'Unknown'}`,
      `*Status:* ${STATUS_EMOJI[task.status] ?? ''} ${task.status}`,
    ]),
    actionsBlock(
      [
        button('View Task', 'view_task', {
          url: `${APP_URL}/${workspaceId}/tasks?task=${task.id}`,
        }),
      ],
      'deadline_warning_actions',
    ),
  ];

  await chatPostMessage(conn.botToken, channel, `Deadline warning: ${task.title}`, { blocks });
  return true;
}

/**
 * Post to channel when a task is completed.
 */
export async function sendTaskCompletedNotification(
  workspaceId: string,
  task: TaskPayload,
  channel?: string,
): Promise<boolean> {
  if (!(await isEventEnabled(workspaceId, 'task.completed'))) return false;

  const conn = await resolveSlackConnection(workspaceId);
  if (!conn) return false;

  const targetChannel = channel ?? conn.channelId;
  if (!targetChannel) return false;

  const blocks: SlackBlock[] = [
    markdownSection(`:white_check_mark: *Task completed* — ${taskLink(task)}`),
    fieldsSection([
      `*Completed by:* ${task.assignee ?? 'Unknown'}`,
      `*Priority:* ${task.priority ?? 'Medium'}`,
    ]),
    contextBlock([
      {
        type: 'mrkdwn',
        text: `Completed ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      },
    ]),
  ];

  await chatPostMessage(conn.botToken, targetChannel, `Task completed: ${task.title}`, { blocks });
  return true;
}

/**
 * Post a project status update to a channel.
 */
export async function sendProjectStatusUpdate(
  workspaceId: string,
  project: ProjectPayload,
  channel: string,
): Promise<boolean> {
  if (!(await isEventEnabled(workspaceId, 'project.status'))) return false;

  const conn = await resolveSlackConnection(workspaceId);
  if (!conn) return false;

  const targetChannel = channel ?? conn.channelId;
  if (!targetChannel) return false;

  const progress = project.progress ?? 0;
  const completed = project.completed_count ?? 0;
  const total = project.task_count ?? 0;

  // Build a simple progress bar
  const filledBlocks = Math.round(progress / 10);
  const emptyBlocks = 10 - filledBlocks;
  const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);

  const blocks: SlackBlock[] = [
    headerBlock(`📊 Project Update: ${project.name}`),
    divider(),
    fieldsSection([
      `*Status:* ${project.status}`,
      `*Progress:* ${progress}%`,
      `*Tasks:* ${completed}/${total} completed`,
    ]),
    markdownSection(`\`${progressBar}\` ${progress}%`),
    divider(),
    actionsBlock(
      [
        button('View Project', 'view_dashboard', {
          url: `${APP_URL}/${workspaceId}/projects/${project.id}`,
        }),
      ],
      'project_status_actions',
    ),
  ];

  await chatPostMessage(conn.botToken, targetChannel, `Project update: ${project.name}`, {
    blocks,
  });
  return true;
}
