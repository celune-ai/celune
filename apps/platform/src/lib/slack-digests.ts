/**
 * apps/platform/src/lib/slack-digests.ts
 *
 * Daily and weekly digest generators for Slack. Returns Block Kit blocks
 * arrays ready to post via chatPostMessage.
 *
 * - Daily: tasks created/completed today, active projects summary
 * - Weekly: completion rate, top contributors, project milestones
 */

import { createServiceClient } from '@repo/db/service';
import {
  type SlackBlock,
  headerBlock,
  markdownSection,
  fieldsSection,
  divider,
  contextBlock,
  actionsBlock,
  button,
} from './slack-api';
import { APP_URL } from '@/lib/branding';

// ── Daily digest ────────────────────────────────────────────────────────────

/**
 * Generate a daily digest for a workspace.
 * Shows tasks created/completed today and active projects.
 */
export async function generateDailyDigest(workspaceId: string): Promise<SlackBlock[]> {
  const supabase = createServiceClient();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();

  // Fetch tasks completed today
  const { data: completedTasks } = await supabase
    .from('tasks')
    .select('id, title, assignee, completed_at')
    .eq('workspace_id', workspaceId)
    .eq('status', 'done')
    .gte('completed_at', todayISO)
    .order('completed_at', { ascending: false })
    .limit(15);

  // Fetch tasks created today
  const { data: createdTasks } = await supabase
    .from('tasks')
    .select('id, title, status, assignee, priority')
    .eq('workspace_id', workspaceId)
    .gte('created_at', todayISO)
    .order('created_at', { ascending: false })
    .limit(15);

  // Fetch open task counts by status
  const { data: openTasks } = await supabase
    .from('tasks')
    .select('status')
    .eq('workspace_id', workspaceId)
    .neq('status', 'done');

  const statusCounts: Record<string, number> = {};
  for (const t of openTasks ?? []) {
    statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
  }
  const totalOpen = openTasks?.length ?? 0;

  // Fetch active projects
  const { data: activeProjects } = await supabase
    .from('projects')
    .select('id, name, status')
    .eq('workspace_id', workspaceId)
    .in('status', ['active', 'in_progress'])
    .order('updated_at', { ascending: false })
    .limit(5);

  // ── Build blocks ──────────────────────────────────────────────────────
  const blocks: SlackBlock[] = [];
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  blocks.push(headerBlock(`Daily Digest — ${dateStr}`));
  blocks.push(divider());

  // Stats summary
  const completedCount = completedTasks?.length ?? 0;
  const createdCount = createdTasks?.length ?? 0;

  blocks.push(
    fieldsSection([
      `:white_check_mark: *${completedCount}* tasks completed`,
      `:new: *${createdCount}* tasks created`,
      `:clipboard: *${totalOpen}* tasks open`,
      `:bar_chart: *${activeProjects?.length ?? 0}* active projects`,
    ]),
  );

  blocks.push(divider());

  // Completed tasks
  if (completedCount > 0) {
    blocks.push(markdownSection('*Completed Today*'));
    const lines = (completedTasks ?? [])
      .slice(0, 10)
      .map((t) => {
        const agent = t.assignee ? ` — ${t.assignee}` : '';
        return `:white_check_mark: ${t.title}${agent}`;
      })
      .join('\n');
    blocks.push(markdownSection(lines));
    if (completedCount > 10) {
      blocks.push(contextBlock([{ type: 'mrkdwn', text: `_...and ${completedCount - 10} more_` }]));
    }
    blocks.push(divider());
  }

  // Created tasks
  if (createdCount > 0) {
    blocks.push(markdownSection('*Created Today*'));
    const lines = (createdTasks ?? [])
      .slice(0, 10)
      .map((t) => {
        const status = t.status === 'done' ? ':white_check_mark:' : ':new:';
        const agent = t.assignee ? ` — ${t.assignee}` : '';
        return `${status} ${t.title}${agent}`;
      })
      .join('\n');
    blocks.push(markdownSection(lines));
    if (createdCount > 10) {
      blocks.push(contextBlock([{ type: 'mrkdwn', text: `_...and ${createdCount - 10} more_` }]));
    }
    blocks.push(divider());
  }

  // Open task breakdown
  if (totalOpen > 0) {
    blocks.push(markdownSection('*Open Tasks by Status*'));
    const statusLines = Object.entries(statusCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([status, count]) => `• *${status}*: ${count}`)
      .join('\n');
    blocks.push(markdownSection(statusLines));
    blocks.push(divider());
  }

  // Active projects
  if (activeProjects && activeProjects.length > 0) {
    blocks.push(markdownSection('*Active Projects*'));
    const lines = activeProjects
      .map((p) => `:rocket: <${APP_URL}/${workspaceId}/projects/${p.id}|${p.name}> — ${p.status}`)
      .join('\n');
    blocks.push(markdownSection(lines));
    blocks.push(divider());
  }

  // Footer
  blocks.push(
    actionsBlock(
      [
        button('Open Dashboard', 'view_dashboard', {
          url: `${APP_URL}/${workspaceId}`,
        }),
      ],
      'daily_digest_actions',
    ),
  );

  blocks.push(
    contextBlock([
      {
        type: 'mrkdwn',
        text: `Celune Daily Digest · ${dateStr} · <${APP_URL}/${workspaceId}/settings|Manage notifications>`,
      },
    ]),
  );

  return blocks;
}

// ── Weekly digest ───────────────────────────────────────────────────────────

/**
 * Generate a weekly digest for a workspace.
 * Shows completion rate, top contributors, project milestones.
 */
export async function generateWeeklyDigest(workspaceId: string): Promise<SlackBlock[]> {
  const supabase = createServiceClient();
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);
  const weekISO = weekStart.toISOString();

  // Tasks completed this week
  const { data: completedTasks } = await supabase
    .from('tasks')
    .select('id, title, assignee, completed_at')
    .eq('workspace_id', workspaceId)
    .eq('status', 'done')
    .gte('completed_at', weekISO)
    .order('completed_at', { ascending: false });

  // Tasks created this week
  const { data: createdTasks } = await supabase
    .from('tasks')
    .select('id, title, status, assignee')
    .eq('workspace_id', workspaceId)
    .gte('created_at', weekISO);

  // All open tasks
  const { data: openTasks } = await supabase
    .from('tasks')
    .select('status')
    .eq('workspace_id', workspaceId)
    .neq('status', 'done');

  // Projects with recent activity
  const { data: activeProjects } = await supabase
    .from('projects')
    .select('id, name, status')
    .eq('workspace_id', workspaceId)
    .gte('updated_at', weekISO)
    .order('updated_at', { ascending: false })
    .limit(10);

  // ── Compute stats ─────────────────────────────────────────────────────
  const completedCount = completedTasks?.length ?? 0;
  const createdCount = createdTasks?.length ?? 0;
  const totalOpen = openTasks?.length ?? 0;

  // Completion rate: completed / (completed + still open from this week's created)
  const weekCreatedStillOpen = (createdTasks ?? []).filter((t) => t.status !== 'done').length;
  const completionRate =
    createdCount > 0
      ? Math.round((completedCount / (completedCount + weekCreatedStillOpen)) * 100)
      : 0;

  // Top contributors (by completed tasks)
  const contributorMap: Record<string, number> = {};
  for (const t of completedTasks ?? []) {
    if (t.assignee) {
      contributorMap[t.assignee] = (contributorMap[t.assignee] ?? 0) + 1;
    }
  }
  const topContributors = Object.entries(contributorMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  // ── Build blocks ──────────────────────────────────────────────────────
  const blocks: SlackBlock[] = [];
  const weekEndStr = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  });
  const weekStartStr = weekStart.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  });

  blocks.push(headerBlock(`Weekly Digest — ${weekStartStr} to ${weekEndStr}`));
  blocks.push(divider());

  // Key metrics
  blocks.push(markdownSection('*Key Metrics*'));
  blocks.push(
    fieldsSection([
      `:white_check_mark: *${completedCount}* completed`,
      `:new: *${createdCount}* created`,
      `:clipboard: *${totalOpen}* open`,
      `:chart_with_upwards_trend: *${completionRate}%* completion rate`,
    ]),
  );

  // Progress bar for completion rate
  const filledBlocks = Math.round(completionRate / 10);
  const emptyBlocks = 10 - filledBlocks;
  const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
  blocks.push(markdownSection(`\`${progressBar}\` ${completionRate}% throughput`));

  blocks.push(divider());

  // Top contributors
  if (topContributors.length > 0) {
    blocks.push(markdownSection('*Top Contributors*'));
    const medals = [':first_place_medal:', ':second_place_medal:', ':third_place_medal:'];
    const lines = topContributors
      .map(([name, count], i) => {
        const medal = medals[i] ?? ':star:';
        return `${medal} *${name}* — ${count} task${count !== 1 ? 's' : ''} completed`;
      })
      .join('\n');
    blocks.push(markdownSection(lines));
    blocks.push(divider());
  }

  // Project milestones
  if (activeProjects && activeProjects.length > 0) {
    blocks.push(markdownSection('*Project Activity This Week*'));
    const lines = activeProjects
      .map((p) => `:rocket: <${APP_URL}/${workspaceId}/projects/${p.id}|${p.name}> — ${p.status}`)
      .join('\n');
    blocks.push(markdownSection(lines));
    blocks.push(divider());
  }

  // Completed task highlights (top 10)
  if (completedCount > 0) {
    blocks.push(markdownSection('*Completed This Week*'));
    const lines = (completedTasks ?? [])
      .slice(0, 10)
      .map((t) => {
        const agent = t.assignee ? ` — ${t.assignee}` : '';
        return `:white_check_mark: ${t.title}${agent}`;
      })
      .join('\n');
    blocks.push(markdownSection(lines));
    if (completedCount > 10) {
      blocks.push(contextBlock([{ type: 'mrkdwn', text: `_...and ${completedCount - 10} more_` }]));
    }
    blocks.push(divider());
  }

  // Footer
  blocks.push(
    actionsBlock(
      [
        button('Open Dashboard', 'view_dashboard', {
          url: `${APP_URL}/${workspaceId}`,
        }),
        button('View Analytics', 'view_dashboard', {
          url: `${APP_URL}/${workspaceId}/analytics/overview`,
        }),
      ],
      'weekly_digest_actions',
    ),
  );

  blocks.push(
    contextBlock([
      {
        type: 'mrkdwn',
        text: `Celune Weekly Digest · ${weekStartStr}–${weekEndStr} · <${APP_URL}/${workspaceId}/settings|Manage notifications>`,
      },
    ]),
  );

  return blocks;
}
