/**
 * apps/platform/src/lib/slack-unfurl.ts
 *
 * Link unfurling for Celune URLs shared in Slack.
 * Parses app links (the configured app domain) and returns rich preview blocks for:
 *   - Tasks (/tasks?id=UUID)
 *   - Projects (/projects/UUID)
 *   - Agent profiles (/team or /team/AGENT_ID)
 */

import { createServiceClient } from '@repo/db/service';
import { decryptBotToken } from '@repo/notifications/decrypt-webhook';
import type { BotTokenFields } from '@repo/notifications/decrypt-webhook';
import { chatUnfurl } from './slack-api';
import { DOMAIN_APP } from '@/lib/branding';

// ── Types ───────────────────────────────────────────────────────────────────

interface LinkSharedEvent {
  user: string;
  channel: string;
  message_ts: string;
  links: { url: string; domain: string }[];
}

interface UnfurlBlock {
  type: string;
  text?: { type: string; text: string };
  fields?: { type: string; text: string }[];
  elements?: { type: string; text: string }[];
}

// ── Main handler ────────────────────────────────────────────────────────────

const CELUNE_DOMAINS =
  process.env.NODE_ENV === 'development' ? [DOMAIN_APP, 'localhost:3002'] : [DOMAIN_APP];

/**
 * Handle link_shared events — unfurl Celune dashboard URLs with rich previews.
 */
export async function handleLinkShared(event: LinkSharedEvent, teamId: string): Promise<void> {
  // Filter to only Celune URLs
  const celuneLinks = event.links.filter((link) =>
    CELUNE_DOMAINS.some((d) => link.url.includes(d)),
  );

  if (celuneLinks.length === 0) return;

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

  // Build unfurls for each Celune link
  const unfurls: Record<string, { blocks: UnfurlBlock[] }> = {};

  for (const link of celuneLinks) {
    try {
      const blocks = await buildUnfurlBlocks(link.url, conn.workspace_id);
      if (blocks) {
        unfurls[link.url] = { blocks };
      }
    } catch (err) {
      console.error(`[slack/unfurl] Failed to build unfurl for ${link.url}:`, err);
    }
  }

  if (Object.keys(unfurls).length === 0) return;

  await chatUnfurl(botToken, event.channel, event.message_ts, unfurls);
  console.info(`[slack/unfurl] Unfurled ${Object.keys(unfurls).length} Celune links`);
}

// ── URL parsing & block building ─────────────────────────────────────────────

async function buildUnfurlBlocks(url: string, workspaceId: string): Promise<UnfurlBlock[] | null> {
  const parsed = new URL(url);
  const pathname = parsed.pathname;

  // Task: /tasks?id=UUID
  if (pathname === '/tasks' || pathname === '/tasks/') {
    const taskId = parsed.searchParams.get('id');
    if (taskId) return buildTaskUnfurl(taskId, workspaceId);
  }

  // Project: /projects/UUID
  const projectMatch = pathname.match(/^\/projects\/([0-9a-f-]{36})$/);
  if (projectMatch) {
    return buildProjectUnfurl(projectMatch[1], workspaceId);
  }

  // Team/Agent: /team or /team/AGENT_ID
  if (pathname === '/team' || pathname === '/team/') {
    return buildTeamUnfurl(workspaceId);
  }

  return null;
}

// ── Task unfurl ──────────────────────────────────────────────────────────────

const STATUS_EMOJI: Record<string, string> = {
  inbox: '📥',
  assigned: '📋',
  planning: '🗓️',
  in_progress: '⏳',
  review: '👀',
  done: '✅',
  blocked: '🚫',
  backlog: '📦',
};

async function buildTaskUnfurl(taskId: string, workspaceId: string): Promise<UnfurlBlock[] | null> {
  const supabase = createServiceClient();

  const { data: task } = await supabase
    .from('tasks')
    .select('title, status, priority, assignee, created_at')
    .eq('id', taskId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (!task) return null;

  const emoji = STATUS_EMOJI[task.status] ?? '📋';

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${emoji} *${task.title}*` },
      fields: [
        { type: 'mrkdwn', text: `*Status:* ${task.status}` },
        { type: 'mrkdwn', text: `*Priority:* ${task.priority ?? 'normal'}` },
        { type: 'mrkdwn', text: `*Assignee:* ${task.assignee ?? 'Unassigned'}` },
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Celune Task` }],
    },
  ];
}

// ── Project unfurl ───────────────────────────────────────────────────────────

async function buildProjectUnfurl(
  projectId: string,
  workspaceId: string,
): Promise<UnfurlBlock[] | null> {
  const supabase = createServiceClient();

  const { data: project } = await supabase
    .from('projects')
    .select('name, description, status, project_type, category')
    .eq('id', projectId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (!project) return null;

  // Count tasks
  const { count } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('workspace_id', workspaceId);

  const desc = project.description
    ? project.description.slice(0, 150) + (project.description.length > 150 ? '...' : '')
    : 'No description';

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `📂 *${project.name}*\n${desc}` },
      fields: [
        { type: 'mrkdwn', text: `*Status:* ${project.status}` },
        { type: 'mrkdwn', text: `*Type:* ${project.project_type ?? 'feature'}` },
        { type: 'mrkdwn', text: `*Tasks:* ${count ?? 0}` },
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Celune Project` }],
    },
  ];
}

// ── Team unfurl ──────────────────────────────────────────────────────────────

async function buildTeamUnfurl(workspaceId: string): Promise<UnfurlBlock[]> {
  const supabase = createServiceClient();

  const { count } = await supabase
    .from('agent_configs')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:robot_face: *Agent Team*\n${count ?? 0} agents configured in this workspace`,
      },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Celune Team` }],
    },
  ];
}
