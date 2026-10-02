#!/usr/bin/env node

/**
 * Seed Supabase tables with sample data.
 *
 * Usage:
 *   node packages/db/scripts/seed.mjs
 *
 * Requires env vars (reads from apps/platform/.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * What it does:
 *   1. Creates sample projects
 *   2. Creates sample tasks (if VAULT_PATH is set, reads from vault)
 *   3. Logs activity entries for the seed operation
 *
 * Safe to re-run: checks for existing data and skips if tables are populated.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(__dirname, '../../..');

// ---------------------------------------------------------------------------
// Load env from apps/platform/.env.local
// ---------------------------------------------------------------------------

function loadEnv() {
  const envPath = resolve(MONOREPO_ROOT, 'apps/platform/.env.local');
  if (!existsSync(envPath)) {
    console.error('Missing apps/platform/.env.local');
    process.exit(1);
  }
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const val = trimmed.slice(eq + 1);
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

// ---------------------------------------------------------------------------
// Vault path
// ---------------------------------------------------------------------------

const VAULT = process.env.VAULT_PATH || '';

// ---------------------------------------------------------------------------
// Projects to seed
// ---------------------------------------------------------------------------

const PROJECTS = [
  {
    name: 'Website Relaunch',
    description:
      'Redesign and relaunch the marketing site with a new pricing page, docs section, and analytics.',
    status: 'active',
    category: 'product',
    vault_path: '04-projects/website-relaunch.md',
  },
  {
    name: 'Platform Infrastructure',
    description:
      'Core services: health monitoring, notifications, background jobs, and the memory store.',
    status: 'active',
    category: 'infrastructure',
    vault_path: '04-projects/',
  },
  {
    name: 'Dot Voter',
    description:
      'Voting and prioritization app. Early concept stage, needs design exploration and market validation.',
    status: 'active',
    category: 'product',
  },
  {
    name: 'Launch Marketing',
    description: 'Launch announcement, social posts, and a content calendar for the first month.',
    status: 'active',
    category: 'marketing',
  },
];

// ---------------------------------------------------------------------------
// Parse tasks.md
// ---------------------------------------------------------------------------

function parseTasks() {
  const tasksPath = resolve(VAULT, '04-projects/tasks.md');
  if (!existsSync(tasksPath)) {
    console.warn(`tasks.md not found at ${tasksPath}, skipping task import`);
    return { active: [], completed: [] };
  }

  const content = readFileSync(tasksPath, 'utf-8');
  const active = [];
  const completed = [];

  let section = null;
  for (const line of content.split('\n')) {
    if (line.startsWith('## Active')) {
      section = 'active';
      continue;
    }
    if (line.startsWith('## Completed')) {
      section = 'completed';
      continue;
    }
    if (line.startsWith('## ') || line.startsWith('# ')) {
      section = null;
      continue;
    }

    const activeMatch = line.match(/^- \[ \] (?:\*\*[A-Z ]+:\*\* )?(.+)$/);
    if (activeMatch && section === 'active') {
      active.push(activeMatch[1].trim());
      continue;
    }

    const completedMatch = line.match(/^- \[x\] (.+)$/);
    if (completedMatch && section === 'completed') {
      completed.push(completedMatch[1].trim());
      continue;
    }
  }

  return { active, completed };
}

// ---------------------------------------------------------------------------
// Map tasks to Supabase rows
// ---------------------------------------------------------------------------

function mapActiveTasks(titles, projectMap) {
  const taskMappings = [
    {
      match: 'Design task management system',
      status: 'inbox',
      priority: 'high',
      assignee: 'unassigned',
      category: ['design', 'infrastructure'],
      project: 'Platform Infrastructure',
      source: 'vault',
      vault_path: '00-inbox/task-management-system.md',
    },
    {
      match: 'Manual audit',
      status: 'inbox',
      priority: 'normal',
      assignee: 'unassigned',
      category: ['maintenance'],
      project: 'Platform Infrastructure',
      source: 'vault',
      vault_path: '00-inbox/audit-notes.md',
    },
    {
      match: 'Phase 2',
      status: 'in_progress',
      priority: 'high',
      assignee: 'unassigned',
      category: ['development'],
      project: 'Website Relaunch',
      source: 'vault',
    },
    {
      match: 'docs section',
      status: 'planning',
      priority: 'normal',
      assignee: 'unassigned',
      category: ['development', 'content'],
      project: 'Website Relaunch',
      source: 'vault',
    },
    {
      match: 'Domain setup',
      status: 'planning',
      priority: 'normal',
      assignee: 'unassigned',
      category: ['infrastructure'],
      project: 'Website Relaunch',
      source: 'vault',
    },
    {
      match: 'Dashboard auth',
      status: 'planning',
      priority: 'normal',
      assignee: 'unassigned',
      category: ['infrastructure'],
      project: 'Website Relaunch',
      source: 'vault',
    },
    {
      match: 'remote access',
      status: 'in_progress',
      priority: 'normal',
      assignee: 'unassigned',
      category: ['infrastructure'],
      project: 'Platform Infrastructure',
      source: 'vault',
    },
    {
      match: 'Dot Voter',
      status: 'planning',
      priority: 'normal',
      assignee: 'unassigned',
      category: ['product'],
      project: 'Dot Voter',
      source: 'vault',
    },
    {
      match: 'LinkedIn',
      status: 'inbox',
      priority: 'normal',
      assignee: 'unassigned',
      category: ['marketing'],
      project: 'Launch Marketing',
      source: 'vault',
    },
    {
      match: 'Twitter',
      status: 'inbox',
      priority: 'normal',
      assignee: 'unassigned',
      category: ['marketing'],
      project: 'Launch Marketing',
      source: 'vault',
    },
  ];

  return titles.map((title, i) => {
    const mapping =
      taskMappings.find((m) => title.toLowerCase().includes(m.match.toLowerCase())) || {};

    return {
      title,
      status: mapping.status || 'inbox',
      priority: mapping.priority || 'normal',
      assignee: mapping.assignee || 'unassigned',
      category: mapping.category || [],
      project_id: mapping.project ? projectMap[mapping.project] : null,
      source: mapping.source || 'vault',
      source_ref: '04-projects/tasks.md',
      vault_path: mapping.vault_path || null,
      sort_order: (i + 1) * 1000,
    };
  });
}

function mapCompletedTasks(titles, projectMap) {
  // Map completed tasks to projects by keyword matching
  function guessProject(title) {
    const lower = title.toLowerCase();
    if (
      lower.includes('slack') ||
      lower.includes('heartbeat') ||
      lower.includes('feed') ||
      lower.includes('health') ||
      lower.includes('memory') ||
      lower.includes('codebase') ||
      lower.includes('security') ||
      lower.includes('maintenance') ||
      lower.includes('cataloging') ||
      lower.includes('goals') ||
      lower.includes('tasks') ||
      lower.includes('rss')
    ) {
      return 'Platform Infrastructure';
    }
    if (
      lower.includes('next.js') ||
      lower.includes('site') ||
      lower.includes('scaffold') ||
      lower.includes('version')
    ) {
      return 'Website Relaunch';
    }
    return null;
  }

  return titles.map((title, i) => {
    const projectName = guessProject(title);
    return {
      title,
      status: 'done',
      priority: 'normal',
      assignee: 'unassigned',
      category: ['completed'],
      project_id: projectName ? projectMap[projectName] : null,
      source: 'vault',
      source_ref: '04-projects/tasks.md',
      sort_order: (i + 1) * 1000,
      completed_at: new Date().toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------
// Seed logic
// ---------------------------------------------------------------------------

async function checkExisting() {
  const { count: taskCount } = await supabase
    .from('tasks')
    .select('*', { count: 'exact', head: true });
  const { count: projectCount } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true });

  return { tasks: taskCount || 0, projects: projectCount || 0 };
}

async function seedProjects() {
  console.log('\n--- Seeding projects ---');
  const projectMap = {};

  for (const project of PROJECTS) {
    const { data, error } = await supabase.from('projects').insert(project).select().single();

    if (error) {
      console.error(`  Failed to create project "${project.name}":`, error.message);
      continue;
    }

    projectMap[project.name] = data.id;
    console.log(`  Created: ${project.name} (${data.id})`);
  }

  return projectMap;
}

async function seedTasks(projectMap) {
  console.log('\n--- Seeding tasks ---');
  const { active, completed } = parseTasks();
  console.log(`  Found ${active.length} active, ${completed.length} completed in vault`);

  const activeTasks = mapActiveTasks(active, projectMap);
  const completedTasks = mapCompletedTasks(completed, projectMap);
  const allTasks = [...activeTasks, ...completedTasks];

  let created = 0;
  for (const task of allTasks) {
    const { data, error } = await supabase.from('tasks').insert(task).select().single();

    if (error) {
      console.error(`  Failed: "${task.title}":`, error.message);
      continue;
    }

    created++;
    const statusIcon = task.status === 'done' ? 'done' : task.status;
    console.log(`  [${statusIcon}] ${task.title}`);
  }

  console.log(`  Created ${created}/${allTasks.length} tasks`);
  return created;
}

async function seedActivity(projectMap, taskCount) {
  console.log('\n--- Seeding activity log ---');
  const entries = [
    {
      event_type: 'system.seeded',
      severity: 'info',
      source: 'seed-script',
      title: 'Database seeded',
      details: {
        projects: Object.keys(projectMap).length,
        tasks: taskCount,
        vault_path: VAULT,
        seeded_at: new Date().toISOString(),
      },
    },
    {
      event_type: 'system.connected',
      severity: 'info',
      source: 'seed-script',
      title: 'Seed data loaded into Supabase',
      details: {
        vault_path: VAULT,
        tables: ['projects', 'tasks', 'activity_log'],
      },
    },
    {
      event_type: 'milestone.completed',
      severity: 'info',
      source: 'seed-script',
      title: 'Phase 1 complete: scaffold, health API, basic dashboard',
      details: {
        project: 'Website Relaunch',
        phase: 1,
      },
    },
    {
      event_type: 'deployment.version',
      severity: 'info',
      source: 'seed-script',
      title: 'Slack Bot v2.0.0 deployed',
      details: {
        component: 'Slack Bot',
        version: '2.0.0',
        date: '2026-02-24',
        features: 'Catalog channels, auto-cataloging pipeline',
      },
    },
    {
      event_type: 'deployment.version',
      severity: 'info',
      source: 'seed-script',
      title: 'Heartbeat v1.0.0 deployed',
      details: {
        component: 'Heartbeat',
        version: '1.0.0',
        date: '2026-02-23',
        features: 'Gmail/Calendar triage, vault scanning, daily notes',
      },
    },
    {
      event_type: 'deployment.version',
      severity: 'info',
      source: 'seed-script',
      title: 'Feed Scanner v1.0.0 deployed',
      details: {
        component: 'Feed Scanner',
        version: '1.0.0',
        date: '2026-02-23',
        features: 'RSS + Bluesky scanning',
      },
    },
    {
      event_type: 'deployment.version',
      severity: 'info',
      source: 'seed-script',
      title: 'Health Monitor v1.0.0 deployed',
      details: {
        component: 'Health Monitor',
        version: '1.0.0',
        date: '2026-02-23',
        features: 'System health endpoint',
      },
    },
  ];

  let created = 0;
  for (const entry of entries) {
    const { error } = await supabase.from('activity_log').insert(entry);
    if (error) {
      console.error(`  Failed: "${entry.title}":`, error.message);
      continue;
    }
    created++;
    console.log(`  [${entry.event_type}] ${entry.title}`);
  }

  console.log(`  Created ${created}/${entries.length} activity entries`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Supabase Seed Script');
  console.log('====================');
  console.log(`URL: ${supabaseUrl}`);
  console.log(`Vault: ${VAULT}`);

  // Check for existing data
  const existing = await checkExisting();
  if (existing.tasks > 0 || existing.projects > 0) {
    console.log(
      `\nDatabase already has data (${existing.projects} projects, ${existing.tasks} tasks).`,
    );
    console.log('To re-seed, clear the tables first:');
    console.log('  node packages/db/scripts/seed.mjs --force');

    if (!process.argv.includes('--force')) {
      process.exit(0);
    }

    console.log('\n--force flag detected. Clearing existing data...');
    await supabase.from('activity_log').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('task_comments').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('tasks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('projects').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    console.log('  Cleared all tables.');
  }

  const projectMap = await seedProjects();
  const taskCount = await seedTasks(projectMap);
  await seedActivity(projectMap, taskCount);

  console.log('\n====================');
  console.log('Seed complete!');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
