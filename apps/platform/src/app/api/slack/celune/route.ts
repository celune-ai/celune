/**
 * POST /api/slack/celune
 *
 * Handles the /celune slash command for multi-tenant Slack app distribution.
 * Supports: /celune status, /celune help, /celune task create <title>,
 *           /celune task list, /celune project list, etc.
 *
 * Flow:
 * 1. Verify Slack signature (HMAC-SHA256)
 * 2. Resolve workspace from team_id -> slack_connections
 * 3. Parse subcommand and args
 * 4. Ack within 3 seconds (ephemeral response)
 * 5. For async commands, POST follow-up to response_url
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { createActivity } from '@repo/db/queries';
import { verifySlackSignature } from '@/lib/slack-verify';
import {
  type SlackBlock,
  headerBlock,
  markdownSection,
  fieldsSection,
  divider,
  actionsBlock,
  button,
  contextBlock,
} from '@/lib/slack-api';
import { APP_URL } from '@/lib/branding';

export const dynamic = 'force-dynamic';

// ── Rate limiting (in-memory, per-team) ─────────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(teamId: string): boolean {
  const now = Date.now();

  // Prune expired entries to prevent unbounded growth
  if (rateLimitMap.size > 200) {
    for (const [id, entry] of rateLimitMap) {
      if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(id);
    }
  }

  const entry = rateLimitMap.get(teamId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(teamId, { count: 1, windowStart: now });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

// ── Workspace resolution ────────────────────────────────────────────────────

async function resolveWorkspace(teamId: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('slack_connections')
    .select('workspace_id, installation_type')
    .eq('slack_team_id', teamId)
    .eq('is_active', true)
    .maybeSingle();
  return data;
}

// ── Slash command response helpers ──────────────────────────────────────────

function ephemeral(text: string, blocks?: SlackBlock[]) {
  return { response_type: 'ephemeral' as const, text, blocks };
}

// ── Free tier commands (available to all workspaces) ────────────────────────

async function handleStatus(workspaceId: string): Promise<{ text: string; blocks?: SlackBlock[] }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('tasks')
    .select('status')
    .eq('workspace_id', workspaceId)
    .neq('status', 'done');

  if (error) return { text: 'Error fetching tasks' };

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }

  const total = data?.length ?? 0;
  const lines = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([status, count]) => `• *${status}*: ${count}`)
    .join('\n');

  return {
    text: `${total} open tasks`,
    blocks: [
      markdownSection(`:clipboard: *Task Status* (${total} open)`),
      markdownSection(lines || '_No open tasks_'),
    ],
  };
}

function handleHelp(): { text: string; blocks?: SlackBlock[] } {
  const dashboardUrl = APP_URL;
  return {
    text: '/celune commands',
    blocks: [
      headerBlock('Celune Commands'),
      markdownSection('*Free Tier*'),
      markdownSection(
        ['• `/celune status` — Task counts by status', '• `/celune help` — Show this message'].join(
          '\n',
        ),
      ),
      divider(),
      markdownSection('*Pro Tier*'),
      markdownSection(
        [
          '• `/celune task create <title>` — Create a new task',
          '• `/celune task list` — List recent tasks',
          '• `/celune project list` — List active projects',
        ].join('\n'),
      ),
      divider(),
      actionsBlock([button('Open Dashboard', 'celune_dashboard', { url: dashboardUrl })]),
    ],
  };
}

// ── Pro tier commands ───────────────────────────────────────────────────────

async function handleTaskCreate(
  workspaceId: string,
  args: string,
  userId: string,
): Promise<{ text: string; blocks?: SlackBlock[] }> {
  if (!args.trim()) {
    return { text: 'Usage: `/celune task create <title>`' };
  }

  const title = args.trim().slice(0, 70); // enforce 70 char max
  const supabase = createServiceClient();

  // Resolve Celune user from workspace membership
  const { data: conn } = await supabase
    .from('slack_connections')
    .select('celune_user_id')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .maybeSingle();

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      title,
      status: 'inbox',
      priority: 'normal',
      workspace_id: workspaceId,
      user_id: conn?.celune_user_id ?? null,
      source: 'slack',
      source_ref: `slack:${userId}`,
    })
    .select('id, title')
    .single();

  if (error) {
    console.error('[slack/celune] task create error:', error.message);
    return { text: 'Error creating task. Please try again or use the dashboard.' };
  }

  return {
    text: `Task created: ${title}`,
    blocks: [
      markdownSection(`:white_check_mark: *Task created*\n${task.title}`),
      contextBlock([{ type: 'mrkdwn', text: `ID: \`${task.id.slice(0, 8)}\`` }]),
    ],
  };
}

async function handleTaskList(
  workspaceId: string,
): Promise<{ text: string; blocks?: SlackBlock[] }> {
  const supabase = createServiceClient();
  const { data: tasks } = await supabase
    .from('tasks')
    .select('title, status, assignee, priority')
    .eq('workspace_id', workspaceId)
    .neq('status', 'done')
    .order('updated_at', { ascending: false })
    .limit(10);

  if (!tasks?.length) {
    return { text: 'No open tasks', blocks: [markdownSection('_No open tasks._')] };
  }

  const statusIcons: Record<string, string> = {
    inbox: ':inbox_tray:',
    in_progress: ':hourglass:',
    blocked: ':no_entry:',
    planning: ':memo:',
    assigned: ':dart:',
    review: ':eyes:',
  };

  const lines = tasks.map((t) => {
    const icon = statusIcons[t.status] ?? ':grey_question:';
    const agent = t.assignee ? ` (${t.assignee})` : '';
    return `${icon} ${t.title}${agent}`;
  });

  return {
    text: `${tasks.length} open tasks`,
    blocks: [
      markdownSection(`:clipboard: *Recent Tasks* (${tasks.length})`),
      markdownSection(lines.join('\n')),
    ],
  };
}

async function handleProjectList(
  workspaceId: string,
): Promise<{ text: string; blocks?: SlackBlock[] }> {
  const supabase = createServiceClient();
  const { data: projects } = await supabase
    .from('projects')
    .select('name, status, project_type, category')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(10);

  if (!projects?.length) {
    return { text: 'No active projects', blocks: [markdownSection('_No active projects._')] };
  }

  const lines = projects.map((p) => {
    const type = p.project_type ? ` [${p.project_type}]` : '';
    return `• *${p.name}*${type}`;
  });

  return {
    text: `${projects.length} active projects`,
    blocks: [
      markdownSection(`:rocket: *Active Projects* (${projects.length})`),
      markdownSection(lines.join('\n')),
    ],
  };
}

// ── Tier check ──────────────────────────────────────────────────────────────

const FREE_COMMANDS = new Set(['status', 'help']);

// TODO: Implement actual tier check from workspace subscription
// For now, all commands are accessible (beta/early access)
function _isProTier(_workspaceId: string): boolean {
  return true;
}

// ── Command routing ─────────────────────────────────────────────────────────

type CommandHandler = (
  workspaceId: string,
  args: string,
  userId: string,
) => Promise<{ text: string; blocks?: SlackBlock[] }> | { text: string; blocks?: SlackBlock[] };

function parseCommand(text: string): { command: string; subcommand: string; args: string } {
  const parts = text.trim().split(/\s+/);
  const command = (parts[0] ?? 'help').toLowerCase();

  // Handle two-word commands: "task create", "task list", "project list"
  if (['task', 'project'].includes(command) && parts[1]) {
    return {
      command,
      subcommand: parts[1].toLowerCase(),
      args: parts.slice(2).join(' '),
    };
  }

  return { command, subcommand: '', args: parts.slice(1).join(' ') };
}

// ── POST handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // Verify Slack signature
  const sig = request.headers.get('x-slack-signature');
  const ts = request.headers.get('x-slack-request-timestamp');
  const verification = verifySlackSignature(sig, ts, rawBody);

  if (!verification.valid) {
    return NextResponse.json({ error: verification.reason }, { status: 401 });
  }

  // Parse URL-encoded form body
  const params = new URLSearchParams(rawBody);
  const teamId = params.get('team_id') ?? '';
  const userId = params.get('user_id') ?? '';
  const commandText = (params.get('text') ?? '').trim();
  const channelId = params.get('channel_id') ?? '';
  // const responseUrl = params.get('response_url') ?? '';

  // Rate limiting per workspace
  if (!checkRateLimit(teamId)) {
    return NextResponse.json(
      ephemeral(':hourglass: Too many commands. Please wait a moment and try again.'),
      { status: 429 },
    );
  }

  // Resolve workspace from Slack team
  const workspace = await resolveWorkspace(teamId);
  if (!workspace) {
    return NextResponse.json(
      ephemeral(
        ':warning: This Slack workspace is not connected to Celune. Visit the Celune dashboard to connect.',
      ),
    );
  }

  const { workspace_id: workspaceId } = workspace;
  const { command, subcommand, args } = parseCommand(commandText);

  // Tier gating
  if (!FREE_COMMANDS.has(command) && !_isProTier(workspaceId)) {
    return NextResponse.json(
      ephemeral(':lock: This command requires a Pro plan. Visit the dashboard to upgrade.'),
    );
  }

  // Route to handler
  let handler: CommandHandler | null = null;

  switch (command) {
    case 'status':
      handler = (wid) => handleStatus(wid);
      break;
    case 'help':
    case '':
      handler = () => handleHelp();
      break;
    case 'task':
      if (subcommand === 'create') handler = (wid, a, uid) => handleTaskCreate(wid, a, uid);
      else if (subcommand === 'list') handler = (wid) => handleTaskList(wid);
      else
        return NextResponse.json(
          ephemeral(
            `Unknown task subcommand: \`${subcommand}\`. Try \`task create\` or \`task list\`.`,
          ),
        );
      break;
    case 'project':
      if (subcommand === 'list') handler = (wid) => handleProjectList(wid);
      else
        return NextResponse.json(
          ephemeral(`Unknown project subcommand: \`${subcommand}\`. Try \`project list\`.`),
        );
      break;
    default:
      return NextResponse.json(
        ephemeral(
          `:question: Unknown command \`${command}\`. Try \`/celune help\` for available commands.`,
        ),
      );
  }

  try {
    const result = await handler(workspaceId, args, userId);

    // Log execution
    try {
      const supabase = createServiceClient();
      await createActivity(supabase, {
        event_type: 'slack.command_executed',
        severity: 'info',
        source: 'slack-celune',
        title: `/celune ${command}${subcommand ? ' ' + subcommand : ''}`,
        details: {
          team_id: teamId,
          user_id: userId,
          command,
          subcommand: subcommand || undefined,
          args: args || undefined,
          channel_id: channelId,
          workspace_id: workspaceId,
        },
      });
    } catch {
      // Non-fatal
    }

    return NextResponse.json(ephemeral(result.text, result.blocks));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(ephemeral(`:x: Command failed: ${message}`));
  }
}
