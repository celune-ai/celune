#!/usr/bin/env node

/**
 * Task Bridge CLI. Connects Claude Code agent teams to the Celune kanban.
 *
 * Usage:
 *   node packages/db/scripts/task-cli.mjs <command> [options]
 *   pnpm task <command> [options]
 *
 * Commands:
 *   create          --title "..." [--assignee <agent-id>] [--status <s>] [--project <id>] [--description "..."] [--outcome "..."] [--priority <p>] [--depends-on <id,id,...>] [--spawned-by <task-uuid>]
 *   create-project  --name "..." [--description "..."] [--type <feature|system|research|plan>] [--category <cat>] [--group <group-id>] [--workspace <workspace-id>]
 *   claim    <id> --agent <agent-id>
 *   complete <id> --agent <agent-id> [--outcome "..."]
 *   block    <id> --reason "..." --agent <agent-id>
 *   unblock  <id>
 *   update   <id> --status <s> [--title "..."] [--assignee <a>] [--priority <p>] [--depends-on <id,id,...>]
 *   comment  <id> --author <name> --content "..."
 *   list     [--status <s>] [--assignee <a>] [--project <id>] [--limit <n>] [--workspace <id>]
 *   heartbeat --agent <agent-id> --status <online|working|idle|offline>
 *
 * Task and project commands go through @celuneai/core, so the same lifecycle
 * rules apply here as in the REST routes and the MCP tools. Node 22.18 or newer
 * is required because the core package is imported as TypeScript source.
 *
 * Requires env vars (reads from apps/platform/.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * All write commands output JSON to stdout and log activity entries.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { createScope, createServices, isCoreError, transitionPath } from '../../core/src/index.ts';
import { SupabaseStore } from '../../core/src/supabase/index.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(__dirname, '../../..');

// ---------------------------------------------------------------------------
// Agent ID → short name mapping (heartbeat only; ids are already short names)
// ---------------------------------------------------------------------------

const AGENT_SHORT_NAMES = {
  rick: 'rick',
  eric: 'eric',
  sage: 'sage',
  noir: 'noir',
  scan: 'scan',
  delv: 'delv',
  trek: 'trek',
  echo: 'echo',
  bond: 'bond',
  vita: 'vita',
  ward: 'ward',
};

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

// ---------------------------------------------------------------------------
// Session-task link file — correlates a Claude Code session to a task
// ---------------------------------------------------------------------------

const SESSION_TASK_FILE = join(homedir(), '.claude', 'session-task.json');

/**
 * Write { session_id, task_id } so the Stop hook can find the active task.
 * session_id is read from the CLAUDE_SESSION_ID env var (set by Claude Code).
 */
function writeSessionTask(taskId) {
  const sessionId = process.env.CLAUDE_SESSION_ID || null;
  if (!sessionId) return; // Not running inside Claude Code — skip
  try {
    writeFileSync(
      SESSION_TASK_FILE,
      JSON.stringify({ session_id: sessionId, task_id: taskId }),
      'utf-8',
    );
  } catch {
    // Non-fatal
  }
}

/**
 * Clear the session-task link on task completion or explicit release.
 */
function clearSessionTask() {
  try {
    writeFileSync(SESSION_TASK_FILE, JSON.stringify({}), 'utf-8');
  } catch {
    // Non-fatal
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);
const services = createServices(new SupabaseStore(supabase));

// ---------------------------------------------------------------------------
// Owner UID resolver — caches the first auth user's ID for user_id columns
// ---------------------------------------------------------------------------

let _ownerUid = null;
async function getOwnerUid() {
  if (_ownerUid) return _ownerUid;
  const { data, error } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role', 'owner')
    .limit(1)
    .single();
  if (error || !data) {
    // Fallback: get the first auth user via admin API
    const { data: authData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (authData?.users?.length) {
      _ownerUid = authData.users[0].id;
    } else {
      process.stderr.write('Warning: could not resolve owner user_id\n');
      return null;
    }
  } else {
    _ownerUid = data.user_id;
  }
  return _ownerUid;
}

async function actorContext(agentId = null) {
  return {
    source: 'task-cli',
    ownerUserId: await getOwnerUid(),
    agentId,
  };
}

// ---------------------------------------------------------------------------
// Embedding helper (calls Supabase Edge Function)
// ---------------------------------------------------------------------------

async function generateEmbedding(text) {
  const fnUrl = `${supabaseUrl}/functions/v1/generate-embedding`;
  try {
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ input: text }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`Embedding generation failed: ${res.status} ${err}`);
      return null;
    }
    const { embeddings } = await res.json();
    return embeddings; // float[] of 384 dimensions
  } catch (err) {
    console.error(`Embedding generation error: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const positional = [];
  const flags = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(args[i]);
    }
  }

  return { command, positional, flags };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
}

/** Runs a service call and turns a CoreError into the CLI's JSON error exit. */
async function run(fn) {
  try {
    return await fn();
  } catch (error) {
    if (isCoreError(error)) {
      let message = error.message;
      if (error.code === 'invalid_transition') {
        const path = transitionPath(error.from, error.to);
        message += path
          ? `. Allowed path: ${error.from} -> ${path.join(' -> ')}`
          : '. No allowed path exists';
      }
      fail(message);
    }
    fail(error?.message ?? String(error));
  }
}

/**
 * Resolve a task by full UUID or 8+ character prefix and return
 * { id, title, scope } where scope is built from the task's own workspace.
 */
async function resolveTask(input) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const PARTIAL_RE = /^[0-9a-f]{8,}$/i;

  if (!UUID_RE.test(input) && !PARTIAL_RE.test(input)) {
    fail(`Invalid task ID "${input}". Must be a full UUID or an 8+ character hex prefix.`);
  }

  let query = supabase.from('tasks').select('id, title, workspace_id, org_id');
  if (UUID_RE.test(input)) {
    query = query.eq('id', input);
  }
  const { data: allData, error } = await query;
  if (error) fail(`ID resolution failed: ${error.message}`);

  const prefix = input.toLowerCase();
  const data = (allData || []).filter((t) => t.id.toLowerCase().startsWith(prefix));

  if (data.length === 0) fail(`No task found matching prefix "${input}"`);
  if (data.length > 1) {
    const candidates = data.map((t) => `  ${t.id}  ${t.title}`).join('\n');
    fail(`Ambiguous prefix "${input}" matches ${data.length} tasks:\n${candidates}`);
  }

  const task = data[0];
  if (!task.workspace_id) fail(`Task ${task.id} has no workspace_id`);
  return {
    id: task.id,
    title: task.title,
    scope: createScope({ workspaceId: task.workspace_id, orgId: task.org_id ?? null }),
  };
}

/** Resolve a workspace: flag, then celune-app slug, then state file, then first workspace. */
async function resolveWorkspace(flagValue) {
  if (flagValue) {
    const { data: ws } = await supabase
      .from('workspaces')
      .select('id, org_id')
      .eq('id', flagValue)
      .maybeSingle();
    if (!ws) fail(`Workspace not found: ${flagValue}`);
    return createScope({ workspaceId: ws.id, orgId: ws.org_id ?? null });
  }

  // Always resolve by slug first; active-workspace.json can be stale when testing other accounts
  const { data: bySlug } = await supabase
    .from('workspaces')
    .select('id, org_id')
    .eq('slug', 'celune-app')
    .maybeSingle();
  if (bySlug) return createScope({ workspaceId: bySlug.id, orgId: bySlug.org_id ?? null });

  const statePath = join(homedir(), '.claude', 'state', 'active-workspace.json');
  if (existsSync(statePath)) {
    try {
      const stateData = JSON.parse(readFileSync(statePath, 'utf-8'));
      if (stateData.workspace_id) {
        const { data: ws } = await supabase
          .from('workspaces')
          .select('id, org_id')
          .eq('id', stateData.workspace_id)
          .maybeSingle();
        if (ws) return createScope({ workspaceId: ws.id, orgId: ws.org_id ?? null });
      }
    } catch {
      // no usable state file
    }
  }

  const { data: fallback } = await supabase
    .from('workspaces')
    .select('id, org_id')
    .limit(1)
    .maybeSingle();
  if (fallback) return createScope({ workspaceId: fallback.id, orgId: fallback.org_id ?? null });

  fail(
    'workspace_id is required. Use --workspace <id>, --project (inherits workspace), or set active-workspace.json.',
  );
}

// ---------------------------------------------------------------------------
// Task commands (through TaskService)
// ---------------------------------------------------------------------------

async function cmdCreate(flags) {
  const title = flags.title;
  if (!title) {
    console.error(
      'Usage: task-cli.mjs create --title "..." [--assignee <id>] [--status <s>] [--project <id>] [--description "..."] [--priority <p>] [--spawned-by <task-uuid>]',
    );
    process.exit(1);
  }

  // Inherit the workspace from the project when one is given
  let scope = null;
  if (flags.project) {
    const { data: proj } = await supabase
      .from('projects')
      .select('org_id,workspace_id')
      .eq('id', flags.project)
      .maybeSingle();
    if (proj?.workspace_id) {
      scope = createScope({ workspaceId: proj.workspace_id, orgId: proj.org_id ?? null });
    }
  }
  if (!scope) scope = await resolveWorkspace(flags.workspace);

  const userId = await getOwnerUid();
  const input = {
    title,
    status: flags.status || 'inbox',
    assignee: flags.assignee || 'unassigned',
    priority: flags.priority || 'normal',
    project_id: flags.project || null,
    description: flags.description || null,
    ...(flags.outcome ? { outcome: flags.outcome } : {}),
    ...(flags['spawned-by'] ? { spawned_by: flags['spawned-by'] } : {}),
    category: flags.category ? flags.category.split(',') : [],
    ...(flags['depends-on']
      ? { depends_on: flags['depends-on'].split(',').map((s) => s.trim()) }
      : {}),
    ...(flags.effort ? { effort: flags.effort } : {}),
    ...(flags['success-criteria']
      ? { success_criteria: JSON.parse(flags['success-criteria']) }
      : {}),
    source: 'agent-cli',
    sort_order: Math.floor(Date.now() / 1000) % 2000000000,
    metadata: {},
    ...(userId ? { user_id: userId } : {}),
  };

  const task = await run(() =>
    services.tasks.create(scope, input, actorContextSync(userId, flags.assignee ?? null)),
  );
  console.log(JSON.stringify(task, null, 2));
}

function actorContextSync(ownerUserId, agentId = null) {
  return { source: 'task-cli', ownerUserId, agentId };
}

async function cmdClaim(positional, flags) {
  const rawId = positional[0];
  const agent = flags.agent;

  if (!rawId || !agent) {
    console.error('Usage: task-cli.mjs claim <task-id> --agent <agent-id>');
    process.exit(1);
  }

  const { id, scope } = await resolveTask(rawId);
  const actor = await actorContext(agent);
  const task = await run(() => services.tasks.claim(scope, id, agent, actor));

  // Link this Claude Code session to the task so the Stop hook can track tokens/cost
  writeSessionTask(id);

  console.log(JSON.stringify(task, null, 2));
}

async function cmdComplete(positional, flags) {
  const rawId = positional[0];
  const agent = flags.agent;

  if (!rawId || !agent) {
    console.error('Usage: task-cli.mjs complete <task-id> --agent <agent-id>');
    process.exit(1);
  }

  const { id, scope } = await resolveTask(rawId);

  if (!flags.outcome || !flags.outcome.trim()) {
    console.warn(
      '\x1b[33m⚠ WARNING: No --outcome provided. Retros depend on task outcomes to evaluate project execution.\x1b[0m',
    );
    console.warn(
      '\x1b[33m  Usage: --outcome "Built X, changed files Y/Z, verified with type-check + build + test."\x1b[0m',
    );
  }

  const actor = await actorContext(agent);
  const task = await run(() =>
    services.tasks.complete(scope, id, { agentId: agent, outcome: flags.outcome ?? null }, actor),
  );

  // Release the session-task link so the Stop hook knows the session is done
  clearSessionTask();

  console.log(JSON.stringify(task, null, 2));
}

async function cmdBlock(positional, flags) {
  const rawId = positional[0];
  const reason = flags.reason;
  const agent = flags.agent;

  if (!rawId || !reason || !agent) {
    console.error('Usage: task-cli.mjs block <task-id> --reason "..." --agent <agent-id>');
    process.exit(1);
  }

  const { id, scope } = await resolveTask(rawId);
  const actor = await actorContext(agent);
  const task = await run(() => services.tasks.block(scope, id, { reason, agentId: agent }, actor));
  console.log(JSON.stringify(task, null, 2));
}

async function cmdUnblock(positional) {
  const rawId = positional[0];

  if (!rawId) {
    console.error('Usage: task-cli.mjs unblock <task-id>');
    process.exit(1);
  }

  const { id, scope } = await resolveTask(rawId);
  const actor = await actorContext();
  const task = await run(() => services.tasks.unblock(scope, id, actor));
  console.log(JSON.stringify(task, null, 2));
}

async function cmdUpdate(positional, flags) {
  const rawId = positional[0];

  if (!rawId) {
    console.error(
      'Usage: task-cli.mjs update <task-id> --status <s> [--title "..."] [--assignee <a>] [--priority <p>]',
    );
    process.exit(1);
  }

  const { id, scope } = await resolveTask(rawId);

  const updates = {};
  if (flags.status) updates.status = flags.status;
  if (flags.title) updates.title = flags.title;
  if (flags.assignee) updates.assignee = flags.assignee;
  if (flags.priority) updates.priority = flags.priority;
  if (flags.description) updates.description = flags.description;
  if (flags.outcome) updates.outcome = flags.outcome;
  if (flags.project) updates.project_id = flags.project;
  if (flags['depends-on']) updates.depends_on = flags['depends-on'].split(',').map((s) => s.trim());
  if (flags.effort) updates.effort = flags.effort === 'none' ? null : flags.effort;
  if (flags['success-criteria']) updates.success_criteria = JSON.parse(flags['success-criteria']);

  // Track delegation when reassigning to a different agent
  if (flags.assignee && flags.reason) {
    const current = await run(() => services.tasks.get(scope, id));
    if (current.assignee !== flags.assignee) {
      updates.metadata = {
        delegated_by: current.assignee,
        delegated_at: new Date().toISOString(),
        delegation_reason: flags.reason,
      };
    }
  }

  if (Object.keys(updates).length === 0) {
    console.error(
      'No fields to update. Use --status, --title, --assignee, --priority, --effort, --description, --outcome, --project, or --reason.',
    );
    process.exit(1);
  }

  const actor = await actorContext(flags.assignee ?? null);
  const result = await run(() => services.tasks.update(scope, id, updates, actor));
  console.log(JSON.stringify(result.task, null, 2));
}

async function cmdComment(positional, flags) {
  const rawId = positional[0];
  const author = flags.author;
  const content = flags.content;

  if (!rawId || !author || !content) {
    console.error('Usage: task-cli.mjs comment <task-id> --author <name> --content "..."');
    process.exit(1);
  }

  const { id, scope } = await resolveTask(rawId);
  const userId = await getOwnerUid();
  const comment = await run(() =>
    services.tasks.addComment(
      scope,
      id,
      { author, content, userId },
      actorContextSync(userId, author),
    ),
  );
  console.log(JSON.stringify(comment, null, 2));
}

async function cmdList(flags) {
  const scope = await resolveWorkspace(flags.workspace);
  const limit = parseInt(flags.limit, 10) || 50;
  const tasks = await run(() =>
    services.tasks.list(scope, {
      status: flags.status || undefined,
      assignee: flags.assignee || undefined,
      projectId: flags.project || undefined,
      includeArchived: flags.status === 'archived',
      limit,
    }),
  );
  const rows = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    assignee: t.assignee,
    priority: t.priority,
    project_id: t.project_id,
    metadata: t.metadata,
    created_at: t.created_at,
    completed_at: t.completed_at,
  }));
  console.log(JSON.stringify(rows, null, 2));
}

// ---------------------------------------------------------------------------
// Agent heartbeat (direct; agent_status rows keyed by agent_name for the Team page)
// ---------------------------------------------------------------------------

async function cmdHeartbeat(flags) {
  const agent = flags.agent;
  const status = flags.status;

  if (!agent || !status) {
    console.error(
      'Usage: task-cli.mjs heartbeat --agent <agent-id> --status <online|working|idle|offline>',
    );
    process.exit(1);
  }

  const validStatuses = ['online', 'working', 'idle', 'offline'];
  if (!validStatuses.includes(status)) {
    console.error(`Invalid status "${status}". Must be one of: ${validStatuses.join(', ')}`);
    process.exit(1);
  }

  const now = new Date().toISOString();
  const shortName = AGENT_SHORT_NAMES[agent];
  const userId = await getOwnerUid();

  // Upsert by agent ID
  const row = {
    agent_name: agent,
    status,
    last_heartbeat: now,
    model: flags.model || null,
    updated_at: now,
    ...(userId ? { user_id: userId } : {}),
  };

  const { error: err1 } = await supabase
    .from('agent_status')
    .upsert(row, { onConflict: 'agent_name' });

  if (err1) {
    console.error(JSON.stringify({ error: err1.message }));
    process.exit(1);
  }

  // Also upsert by short name if different
  if (shortName && shortName !== agent) {
    const shortRow = { ...row, agent_name: shortName };
    const { error: err2 } = await supabase
      .from('agent_status')
      .upsert(shortRow, { onConflict: 'agent_name' });

    if (err2) {
      process.stderr.write(`Warning: heartbeat upsert (${shortName}): ${err2.message}\n`);
    }
  }

  console.log(JSON.stringify({ agent, status, last_heartbeat: now }));
}

// ---------------------------------------------------------------------------
// Agent memory commands
// ---------------------------------------------------------------------------

async function cmdRemember(flags) {
  const agent = flags.agent;
  const content = flags.content;
  const category = flags.category || 'general';
  const key = flags.key || `${agent}:${Date.now()}`;

  if (!agent || !content) {
    console.error(
      'Usage: task-cli.mjs remember --agent <id> --content "..." [--category <cat>] [--key <unique-key>]',
    );
    process.exit(1);
  }

  // Generate embedding for semantic search
  const embedding = await generateEmbedding(`${category}: ${content}`);

  const userId = await getOwnerUid();
  const record = {
    key,
    content,
    category,
    source: agent,
    tags: agent,
    updated_at: new Date().toISOString(),
    ...(userId ? { user_id: userId } : {}),
  };
  if (embedding) record.embedding = JSON.stringify(embedding);

  const { data, error } = await supabase
    .from('agent_memory')
    .upsert(record, { onConflict: 'key' })
    .select()
    .single();

  if (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exit(1);
  }

  console.log(JSON.stringify(data, null, 2));
}

async function cmdRecall(flags) {
  const agent = flags.agent;
  const category = flags.category;
  const semanticQuery = flags.query;
  const limit = parseInt(flags.limit, 10) || 20;
  const threshold = parseFloat(flags.threshold) || 0.5;

  if (!agent) {
    console.error(
      'Usage: task-cli.mjs recall --agent <id> [--category <cat>] [--query "..."] [--threshold 0.5] [--limit <n>]',
    );
    process.exit(1);
  }

  // Semantic search mode: --query "decisions about auth"
  if (semanticQuery) {
    const embedding = await generateEmbedding(semanticQuery);
    if (!embedding) {
      console.error('Failed to generate query embedding. Falling back to text search.');
      // Fall through to standard recall below
    } else {
      const { data, error } = await supabase.rpc('match_memories', {
        query_embedding: JSON.stringify(embedding),
        match_threshold: threshold,
        match_count: limit,
        filter_source: agent,
        filter_category: category || null,
      });

      if (error) {
        console.error(JSON.stringify({ error: error.message }));
        process.exit(1);
      }

      console.log(JSON.stringify(data, null, 2));
      return;
    }
  }

  // Standard recall: category-filtered, most recent first
  let query = supabase
    .from('agent_memory')
    .select('id, key, content, category, source, tags, created_at, updated_at')
    .eq('source', agent)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (category) query = query.eq('category', category);

  const { data, error } = await query;

  if (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exit(1);
  }

  console.log(JSON.stringify(data, null, 2));
}

const ALLOWED_MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.py': 'text/x-python',
  '.sql': 'application/sql',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'application/toml',
};

async function cmdAttach(positional, flags) {
  const rawId = positional[0];
  const filePath = flags.file;
  const agent = flags.agent || 'rick';

  if (!rawId || !filePath) {
    console.error('Usage: task-cli.mjs attach <task-id> --file <path> [--agent <id>]');
    process.exit(1);
  }

  const { id: taskId, scope } = await resolveTask(rawId);

  const { statSync } = await import('fs');
  const { basename, extname } = await import('path');
  const { randomUUID } = await import('crypto');

  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const stats = statSync(resolved);
  if (stats.size > 10 * 1024 * 1024) {
    console.error(`File exceeds 10MB limit: ${(stats.size / 1024 / 1024).toFixed(1)}MB`);
    process.exit(1);
  }

  const ext = extname(resolved).toLowerCase();
  const mimeType = ALLOWED_MIME_MAP[ext];
  if (!mimeType) {
    console.error(
      `File type not allowed: ${ext}. Allowed: ${Object.keys(ALLOWED_MIME_MAP).join(', ')}`,
    );
    process.exit(1);
  }

  const fileName = basename(resolved);
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
  const storagePath = `${taskId}/${randomUUID()}_${safeName}`;
  const fileBuffer = readFileSync(resolved);

  // Upload to storage
  const { error: uploadErr } = await supabase.storage
    .from('task-attachments')
    .upload(storagePath, fileBuffer, { contentType: mimeType });

  if (uploadErr) {
    console.error(JSON.stringify({ error: `Storage upload failed: ${uploadErr.message}` }));
    process.exit(1);
  }

  let data;
  try {
    const task = await services.store.tasks.get(scope, taskId);
    data = await services.store.attachments.add(scope, {
      task_id: taskId,
      file_name: fileName,
      file_size: stats.size,
      mime_type: mimeType,
      storage_path: storagePath,
      uploaded_by: agent,
      user_id: task.user_id ?? null,
    });
  } catch (error) {
    // Clean up storage on DB failure
    await supabase.storage.from('task-attachments').remove([storagePath]);
    fail(error.message);
  }

  // Generate signed URL
  const { data: signedData } = await supabase.storage
    .from('task-attachments')
    .createSignedUrl(storagePath, 3600);

  console.log(JSON.stringify({ ...data, download_url: signedData?.signedUrl ?? null }, null, 2));
}

async function cmdBackfillEmbeddings(flags) {
  const batchSize = parseInt(flags.batch, 10) || 50;

  // Fetch memories missing embeddings
  const { data: memories, error } = await supabase
    .from('agent_memory')
    .select('id, key, content, category')
    .is('embedding', null)
    .order('updated_at', { ascending: false })
    .limit(batchSize);

  if (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exit(1);
  }

  if (!memories || memories.length === 0) {
    console.log('All memories have embeddings. Nothing to backfill.');
    return;
  }

  console.log(`Backfilling ${memories.length} memories...`);
  let success = 0;
  let failed = 0;

  for (const mem of memories) {
    const text = `${mem.category}: ${mem.content}`;
    const embedding = await generateEmbedding(text);
    if (!embedding) {
      console.error(`  Failed: ${mem.key}`);
      failed++;
      continue;
    }

    const { error: updateErr } = await supabase
      .from('agent_memory')
      .update({ embedding: JSON.stringify(embedding) })
      .eq('id', mem.id);

    if (updateErr) {
      console.error(`  Update failed for ${mem.key}: ${updateErr.message}`);
      failed++;
    } else {
      success++;
    }
  }

  console.log(`Backfill complete: ${success} updated, ${failed} failed, ${memories.length} total.`);
}

// ---------------------------------------------------------------------------
// Project commands (through ProjectService)
// ---------------------------------------------------------------------------

async function cmdCreateProject(flags) {
  const name = flags.name;
  if (!name) {
    console.error(
      'Usage: task-cli.mjs create-project --name "..." [--description "..."] [--type <feature|system|research|plan>] [--category <cat>] [--group <group-id>] [--workspace <workspace-id>]',
    );
    process.exit(1);
  }

  const scope = await resolveWorkspace(flags.workspace);
  const userId = await getOwnerUid();

  const input = {
    name,
    description: flags.description || null,
    status: 'active',
    project_type: flags.type || 'feature',
    category: flags.category || null,
    ...(flags.group ? { group_id: flags.group } : {}),
    ...(userId ? { user_id: userId } : {}),
  };

  const project = await run(() => services.projects.create(scope, input, actorContextSync(userId)));
  console.log(JSON.stringify(project, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { command, positional, flags } = parseArgs(process.argv);

  if (!command || command === 'help' || flags.help) {
    console.log(`Task Bridge CLI. Connects agent teams to the Celune kanban.

Commands:
  create          --title "..." [--assignee <id>] [--status <s>] [--project <id>] [--description "..."] [--priority <p>] [--depends-on <id,id,...>] [--spawned-by <task-uuid>]
  create-project  --name "..." [--description "..."] [--type <feature|system|research|plan>] [--category <cat>] [--group <group-id>] [--workspace <workspace-id>]
  claim      <id> --agent <agent-id>
  complete   <id> --agent <agent-id> --outcome "..." (RECOMMENDED: retros depend on outcomes)
  block      <id> --reason "..." --agent <agent-id>
  unblock    <id>
  update     <id> --status <s> [--title "..."] [--assignee <a>] [--priority <p>] [--depends-on <id,id,...>] [--reason "..."]
  comment    <id> --author <name> --content "..."
  list       [--status <s>] [--assignee <a>] [--project <id>] [--limit <n>] [--workspace <id>]
  heartbeat  --agent <agent-id> --status <online|working|idle|offline>
  remember   --agent <id> --content "..." [--category <cat>]
  recall     --agent <id> [--category <cat>] [--query "..."] [--threshold 0.5] [--limit <n>]
  attach     <task-id> --file <path> [--agent <id>]

Statuses: backlog, inbox, scoping, planning, in_progress, review, done, archived
Status moves follow the lifecycle table; claim walks inbox tasks through planning.
Priorities: urgent, high, normal, low
Agents: rick, sage, noir, scan, delv, trek, echo, bond, vita, ward`);
    process.exit(0);
  }

  switch (command) {
    case 'create':
      await cmdCreate(flags);
      break;
    case 'create-project':
      await cmdCreateProject(flags);
      break;
    case 'claim':
      await cmdClaim(positional, flags);
      break;
    case 'complete':
      await cmdComplete(positional, flags);
      break;
    case 'block':
      await cmdBlock(positional, flags);
      break;
    case 'unblock':
      await cmdUnblock(positional);
      break;
    case 'update':
      await cmdUpdate(positional, flags);
      break;
    case 'comment':
      await cmdComment(positional, flags);
      break;
    case 'list':
      await cmdList(flags);
      break;
    case 'heartbeat':
      await cmdHeartbeat(flags);
      break;
    case 'remember':
      await cmdRemember(flags);
      break;
    case 'recall':
      await cmdRecall(flags);
      break;
    case 'backfill-embeddings':
      await cmdBackfillEmbeddings(flags);
      break;
    case 'attach':
      await cmdAttach(positional, flags);
      break;
    default:
      console.error(`Unknown command: ${command}. Run with --help for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
