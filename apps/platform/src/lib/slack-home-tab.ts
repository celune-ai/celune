/**
 * apps/platform/src/lib/slack-home-tab.ts
 *
 * Builds and publishes the Celune Home Tab (Agent Panel) for a Slack user.
 * Shows agent status, recent activity, quick actions, and notification settings.
 */

import { createServiceClient } from '@repo/db/service';
import {
  type SlackBlock,
  headerBlock,
  markdownSection,
  fieldsSection,
  divider,
  actionsBlock,
  button,
  contextBlock,
  viewsPublish,
} from './slack-api';
import { APP_URL } from '@/lib/branding';

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

const STATUS_EMOJI: Record<string, string> = {
  active: ':large_green_circle:',
  idle: ':yellow_circle:',
  offline: ':white_circle:',
  busy: ':orange_circle:',
};

interface AgentStatus {
  agent_id: string;
  display_name: string;
  status: string;
  current_task: string | null;
  last_active: string | null;
}

interface RecentTask {
  title: string;
  status: string;
  assignee: string;
  completed_at: string | null;
}

/**
 * Build the Home Tab blocks for a workspace.
 */
async function buildHomeTabBlocks(
  workspaceId: string,
  dashboardUrl: string,
): Promise<SlackBlock[]> {
  const supabase = createServiceClient();
  const blocks: SlackBlock[] = [];

  // ── Header ──────────────────────────────────────────────────────────────
  blocks.push(headerBlock('Celune — Agent Panel'));
  blocks.push(contextBlock([{ type: 'mrkdwn', text: ':large_green_circle: Connected' }]));
  blocks.push(divider());

  // ── Agent Status ────────────────────────────────────────────────────────
  blocks.push(markdownSection('*AGENTS*'));

  const { data: agents } = await supabase
    .from('agent_status')
    .select('agent_id, display_name, status, current_task, last_active')
    .eq('workspace_id', workspaceId)
    .order('agent_id');

  if (agents && agents.length > 0) {
    for (const agent of agents as AgentStatus[]) {
      const emoji = AGENT_EMOJI[agent.agent_id] ?? ':robot_face:';
      const statusEmoji = STATUS_EMOJI[agent.status] ?? ':white_circle:';
      const taskInfo = agent.current_task ? `\n_${agent.current_task}_` : '';
      blocks.push(
        markdownSection(
          `${emoji} *${agent.display_name ?? agent.agent_id.toUpperCase()}* ${statusEmoji}${taskInfo}`,
        ),
      );
    }
  } else {
    blocks.push(
      markdownSection('_No agents configured yet. Visit the dashboard to set up your team._'),
    );
  }

  blocks.push(divider());

  // ── Recent Activity ─────────────────────────────────────────────────────
  blocks.push(markdownSection('*RECENT ACTIVITY*'));

  const { data: recentTasks } = await supabase
    .from('tasks')
    .select('title, status, assignee, completed_at')
    .eq('workspace_id', workspaceId)
    .in('status', ['done', 'in_progress', 'blocked'])
    .order('updated_at', { ascending: false })
    .limit(5);

  if (recentTasks && recentTasks.length > 0) {
    for (const task of recentTasks as RecentTask[]) {
      const icon =
        task.status === 'done'
          ? ':white_check_mark:'
          : task.status === 'blocked'
            ? ':no_entry:'
            : ':hourglass:';
      const agent = task.assignee ? ` — ${task.assignee.toUpperCase()}` : '';
      blocks.push(markdownSection(`${icon} ${task.title}${agent}`));
    }
  } else {
    blocks.push(markdownSection('_No recent activity yet._'));
  }

  blocks.push(divider());

  // ── Quick Actions ───────────────────────────────────────────────────────
  blocks.push(markdownSection('*QUICK ACTIONS*'));
  blocks.push(
    actionsBlock(
      [
        button('Check Status', 'celune_status'),
        button('Create Task', 'celune_create_task'),
        button('View Dashboard', 'celune_dashboard', {
          url: dashboardUrl,
        }),
      ],
      'quick_actions',
    ),
  );

  blocks.push(divider());

  // ── Notification Settings ───────────────────────────────────────────────
  blocks.push(markdownSection('*NOTIFICATIONS*'));

  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('channel, event_types, is_enabled, frequency')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'slack')
    .limit(1)
    .maybeSingle();

  if (prefs) {
    const taskCompletions = prefs.event_types?.includes('task.completed');
    const blockedTasks = prefs.event_types?.includes('task.blocked');
    const digest = prefs.frequency === 'digest_daily' || prefs.frequency === 'digest_weekly';

    blocks.push(
      fieldsSection([
        `:bell: Task completions: *${taskCompletions ? 'ON' : 'OFF'}*`,
        `:bell: Blocked tasks: *${blockedTasks ? 'ON' : 'OFF'}*`,
        `:bar_chart: ${prefs.frequency === 'digest_daily' ? 'Daily' : prefs.frequency === 'digest_weekly' ? 'Weekly' : 'No'} digest: *${digest ? 'ON' : 'OFF'}*`,
      ]),
    );
  } else {
    blocks.push(markdownSection('_Notifications not configured. Visit settings to enable._'));
  }

  // ── Footer ──────────────────────────────────────────────────────────────
  blocks.push(divider());
  blocks.push(
    contextBlock([
      {
        type: 'mrkdwn',
        text: `<${dashboardUrl}|Open Dashboard> · <${dashboardUrl}/settings|Settings> · Powered by Celune`,
      },
    ]),
  );

  return blocks;
}

/**
 * Build a first-run onboarding Home Tab for users without a Celune connection.
 */
function buildOnboardingBlocks(installUrl: string): SlackBlock[] {
  return [
    headerBlock('Welcome to Celune'),
    markdownSection(
      'Celune gives you a team of AI agents that work together to manage tasks, build projects, and keep your workflow running.',
    ),
    divider(),
    markdownSection('*Get Started*'),
    markdownSection(
      ':one: *Connect your workspace* — Link your Slack workspace to Celune\n' +
        ':two: *Meet your agents* — Each agent has a specialty (engineering, design, research...)\n' +
        ':three: *Give them work* — Use `/celune task create` or DM the bot directly',
    ),
    divider(),
    actionsBlock(
      [
        button('Connect to Celune', 'celune_connect', {
          url: installUrl,
          style: 'primary',
        }),
      ],
      'onboarding_actions',
    ),
    contextBlock([
      {
        type: 'mrkdwn',
        text: 'Already have an account? Your dashboard will appear here once connected.',
      },
    ]),
  ];
}

/**
 * Publish the Home Tab for a specific user in a workspace.
 */
export async function publishHomeTab(botToken: string, userId: string, workspaceId: string | null) {
  const dashboardUrl = APP_URL;

  let blocks: SlackBlock[];

  if (workspaceId) {
    blocks = await buildHomeTabBlocks(workspaceId, dashboardUrl);
  } else {
    const signupUrl = `${dashboardUrl}/signup`;
    blocks = buildOnboardingBlocks(signupUrl);
  }

  return viewsPublish(botToken, userId, blocks);
}
