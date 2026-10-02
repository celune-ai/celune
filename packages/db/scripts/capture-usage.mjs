#!/usr/bin/env node

/**
 * Capture Usage — Post-session Claude API cost capture script.
 *
 * Parses `claude -p --output-format json` response and posts token usage
 * to the admin cost ingestion API. Designed to run automatically after
 * AFK sessions via a Stop hook or wrapper script.
 *
 * Usage:
 *   # From CLI args (pass JSON inline):
 *   node packages/db/scripts/capture-usage.mjs \
 *     --json '{"total_cost_usd":0.042,"usage":{"input_tokens":1000,...},"model":"claude-opus-4-6"}' \
 *     --session-id abc123 \
 *     --agent-name rick \
 *     --task-id <uuid>
 *
 *   # From stdin (pipe claude output):
 *   claude -p "..." --output-format json | \
 *     node packages/db/scripts/capture-usage.mjs \
 *       --session-id abc123 \
 *       --agent-name rick \
 *       --task-id <uuid>
 *
 *   # With custom admin URL (defaults to http://localhost:3002):
 *   ADMIN_URL=https://admin.example.com node packages/db/scripts/capture-usage.mjs ...
 *
 * Environment:
 *   ADMIN_URL — Base URL for admin app (default: http://localhost:3002)
 *   CLAUDE_SESSION_ID — Auto-set by Claude Code; used as session-id if --session-id not provided
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(__dirname, '../../..');

// ---------------------------------------------------------------------------
// Load env from apps/platform/.env.local (for ADMIN_URL if set there)
// ---------------------------------------------------------------------------

function loadEnv() {
  const envPath = resolve(MONOREPO_ROOT, 'apps/platform/.env.local');
  if (!existsSync(envPath)) return;
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
// Arg parsing (same pattern as task-cli.mjs)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Read stdin (for piped claude output)
// ---------------------------------------------------------------------------

async function readStdin() {
  // Skip if stdin is a TTY (interactive — nothing piped)
  if (process.stdin.isTTY) return null;

  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Parse claude JSON output
// Fields: total_cost_usd, usage.input_tokens, usage.output_tokens,
//         usage.cache_read_tokens, usage.cache_creation_tokens, model
// ---------------------------------------------------------------------------

function parseClaudioOutput(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse JSON input: ${raw.slice(0, 200)}`);
  }

  const usage = parsed.usage ?? {};

  return {
    model: parsed.model ?? null,
    total_cost_usd: parsed.total_cost_usd ?? 0,
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_tokens: usage.cache_read_tokens ?? 0,
    cache_creation_tokens: usage.cache_creation_tokens ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Post to ingest endpoint
// ---------------------------------------------------------------------------

async function postUsage(payload, adminUrl) {
  // In local dev, admin runs at localhost:3002 with no basePath prefix.
  // In production, Vercel multi-zone rewrites /app/* to the admin deployment
  // (and strips /app before Next.js sees it), so no prefix needed either.
  const url = `${adminUrl}/api/analytics/cost/ingest`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ingest API returned ${res.status}: ${text}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const flags = parseArgs(process.argv);

  if (flags.help) {
    console.log(`capture-usage.mjs — Post Claude session token usage to the cost ingest API.

Usage:
  node capture-usage.mjs [--json '<claude-json>'] [--session-id <id>] [--agent-name <name>] [--task-id <uuid>] [--duration-ms <ms>]

  Or pipe claude output:
  claude -p "..." --output-format json | node capture-usage.mjs --agent-name rick

Flags:
  --json          Raw JSON string from claude CLI (alternative to stdin)
  --session-id    Claude session ID (defaults to CLAUDE_SESSION_ID env var)
  --agent-name    Agent name (e.g. rick, link, noir)
  --task-id       UUID of active task (optional)
  --duration-ms   Session duration in milliseconds (optional)

Environment:
  ADMIN_URL          Base URL of admin app (default: http://localhost:3002)
  CLAUDE_SESSION_ID  Auto-set by Claude Code`);
    process.exit(0);
  }

  const adminUrl = (process.env.ADMIN_URL ?? 'http://localhost:3002').replace(/\/$/, '');

  // Resolve session ID: flag > CLAUDE_SESSION_ID env > generated fallback
  const sessionId = flags['session-id'] || process.env.CLAUDE_SESSION_ID || `manual-${Date.now()}`;

  // Get raw JSON: --json flag or stdin
  let rawJson = flags.json ?? null;
  if (!rawJson) {
    rawJson = await readStdin();
  }

  if (!rawJson) {
    console.error("Error: No JSON input. Pass --json '...' or pipe claude output to stdin.");
    console.error('Run with --help for usage.');
    process.exit(1);
  }

  // Parse claude output
  let parsed;
  try {
    parsed = parseClaudioOutput(rawJson);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  if (!parsed.model) {
    console.error('Error: JSON input missing "model" field.');
    process.exit(1);
  }

  // Build ingest payload
  const payload = {
    session_id: sessionId,
    agent_name: flags['agent-name'] ?? null,
    task_id: flags['task-id'] ?? null,
    model: parsed.model,
    input_tokens: parsed.input_tokens,
    output_tokens: parsed.output_tokens,
    cache_read_tokens: parsed.cache_read_tokens,
    cache_creation_tokens: parsed.cache_creation_tokens,
    total_cost_usd: parsed.total_cost_usd,
    duration_ms: flags['duration-ms'] ? parseInt(flags['duration-ms'], 10) : null,
  };

  // Post to ingest API
  let result;
  try {
    result = await postUsage(payload, adminUrl);
  } catch (err) {
    console.error(`Error posting usage: ${err.message}`);
    process.exit(1);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
