#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(__dirname, '../../..');

// Load env from apps/platform/.env.local
const envPath = resolve(MONOREPO_ROOT, 'apps/platform/.env.local');
if (!existsSync(envPath)) {
  console.error('Missing apps/platform/.env.local');
  process.exit(1);
}

const lines = readFileSync(envPath, 'utf-8').split('\n');
const env = {};
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq);
  const val = trimmed.slice(eq + 1);
  env[key] = val;
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function main() {
  try {
    // Create the project
    console.log('Creating project...');
    const { data: project, error: projError } = await supabase
      .from('projects')
      .insert({
        name: 'RICK Cloudflare Slack Agent',
        description:
          'Build RICK as a persistent AI agent living in Slack via Cloudflare Workers. Fork Moltworker, integrate Claude API + Supabase task system. DMs, @mentions, slash commands. ~2 week MVP.',
        status: 'active',
        category: 'agent',
      })
      .select()
      .single();

    if (projError) {
      console.error('Error creating project:', projError.message);
      process.exit(1);
    }

    console.log('Project created:', project.id);
    const projectId = project.id;

    // Task definitions
    const tasks = [
      {
        title: 'Fork Moltworker and set up CF Workers',
        priority: 'high',
        description:
          'Clone Moltworker repo, configure wrangler.toml, set up Durable Objects, deploy hello-world',
      },
      {
        title: 'Configure Slack app with Events API',
        priority: 'high',
        description:
          'Create Slack app, configure bot scopes (chat:write, channels:read, im:history), set up Events API subscription, OAuth flow',
      },
      {
        title: 'Integrate Claude API via AI Gateway',
        priority: 'high',
        description:
          'Store API key as wrangler secret, implement Claude message handler, configure system prompt with RICK identity',
      },
      {
        title: 'Build conversation context with DO',
        priority: 'normal',
        description:
          'SQLite schema for conversation history, per-thread context isolation, context window management (trim to 20 messages)',
      },
      {
        title: 'Add Supabase task integration tools',
        priority: 'normal',
        description:
          'Implement create_task, claim_task, get_task_status, list_tasks tools that call Supabase REST API directly',
      },
      {
        title: 'Add codebase search and delegation',
        priority: 'normal',
        description:
          'Search tool for repository queries, delegation to other agents (SAGE, DELV) via task creation',
      },
      {
        title: 'Deploy, test, and document',
        priority: 'normal',
        description:
          'Deploy to production, test DM/channel/slash flows, write setup docs, configure webhook URLs',
      },
    ];

    // Create each task
    for (const taskDef of tasks) {
      console.log(`Creating task: "${taskDef.title}"...`);
      const { data: task, error: taskError } = await supabase
        .from('tasks')
        .insert({
          title: taskDef.title,
          priority: taskDef.priority,
          project_id: projectId,
          description: taskDef.description,
          status: 'inbox',
          assignee: 'unassigned',
          source: 'agent-cli',
          sort_order: Math.floor(Date.now() / 1000) % 2000000000,
          metadata: {},
        })
        .select()
        .single();

      if (taskError) {
        console.error(`Error creating task "${taskDef.title}":`, taskError.message);
        process.exit(1);
      }

      console.log(`  Task created: ${task.id}`);
    }

    console.log(`\nSuccess! Project and ${tasks.length} tasks created.`);
    console.log(`Project ID: ${projectId}`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
