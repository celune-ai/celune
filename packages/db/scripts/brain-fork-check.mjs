#!/usr/bin/env node

/**
 * brain-fork-check.mjs — Detect locally modified CORE brain files
 *
 * Compares local file SHA-256 hashes against brain_manifest content_hash.
 * Files that have been modified locally (hash mismatch) are marked as forked.
 *
 * Uses mtime-based filtering via .claude/.brain-state.json to stay fast —
 * only hashes files modified since the last check.
 *
 * Usage:
 *   node packages/db/scripts/brain-fork-check.mjs --workspace-id <uuid>
 *
 * Exit codes:
 *   0 — success (forks detected/marked or nothing to do)
 *   1 — error (missing args)
 *
 * Outputs to stderr only (stdout reserved for structured data).
 */

import { readFileSync, statSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let workspaceId = null;
let envFile = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--workspace-id' && args[i + 1]) {
    workspaceId = args[++i];
  } else if (args[i] === '--env-path' && args[i + 1]) {
    envFile = args[++i];
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!workspaceId || !UUID_RE.test(workspaceId)) {
  process.stderr.write('[brain-fork] Missing or invalid --workspace-id\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load env
// ---------------------------------------------------------------------------

const monorepoRoot = join(__dirname, '..', '..', '..');
const envPath = envFile || join(monorepoRoot, 'apps', 'admin', '.env.local');

// Prefer env vars (set by session-start.sh) over parsing .env.local directly
let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !serviceKey) {
  try {
    const envContent = readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      if (!supabaseUrl && line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) {
        supabaseUrl = line.slice('NEXT_PUBLIC_SUPABASE_URL='.length).trim();
      } else if (!serviceKey && line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) {
        serviceKey = line.slice('SUPABASE_SERVICE_ROLE_KEY='.length).trim();
      }
    }
  } catch {
    process.stderr.write('[brain-fork] Cannot read env file, skipping fork check\n');
    process.exit(0);
  }
}

if (!supabaseUrl || !serviceKey) {
  process.exit(0); // Silently skip — no credentials available
}

// ---------------------------------------------------------------------------
// Brain state (mtime filter)
// ---------------------------------------------------------------------------

const brainStateDir = join(monorepoRoot, '.claude');
const brainStatePath = join(brainStateDir, '.brain-state.json');

function loadBrainState() {
  try {
    return JSON.parse(readFileSync(brainStatePath, 'utf8'));
  } catch {
    return {};
  }
}

function saveBrainState(state) {
  try {
    if (!existsSync(brainStateDir)) {
      mkdirSync(brainStateDir, { recursive: true });
    }
    writeFileSync(brainStatePath, JSON.stringify(state, null, 2) + '\n');
  } catch {
    // Non-fatal — next run will just re-check all files
  }
}

// ---------------------------------------------------------------------------
// Supabase REST helpers
// ---------------------------------------------------------------------------

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

async function supabaseGet(path) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
  if (!res.ok) return null;
  return res.json();
}

async function supabasePatch(table, matchParams, body) {
  const qs = Object.entries(matchParams)
    .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)
    .join('&');
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${qs}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  return res.ok;
}

// ---------------------------------------------------------------------------
// Hash computation (matches registry's computeContentHash)
// ---------------------------------------------------------------------------

function computeContentHash(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Lockfile to prevent concurrent fork-check runs (race condition mitigation)
  const lockPath = join(brainStateDir, '.fork-check.lock');
  try {
    if (!existsSync(brainStateDir)) {
      mkdirSync(brainStateDir, { recursive: true });
    }
    // Atomic lock: wx flag fails with EEXIST if file already exists
    writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
  } catch {
    // Lock exists — check if stale (> 30s)
    try {
      const lockAge = Date.now() - statSync(lockPath).mtimeMs;
      if (lockAge < 30_000) return; // Another fork-check is running — skip
      // Stale lock — remove and retry
      unlinkSync(lockPath);
      writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
    } catch {
      return; // Can't acquire lock — skip gracefully
    }
  }

  try {
    await _main();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
}

async function _main() {
  const brainState = loadBrainState();
  const lastCheckMs = brainState.lastForkCheck ? new Date(brainState.lastForkCheck).getTime() : 0;

  // 1. Fetch CORE manifest rows that are NOT already forked (include updated_at for optimistic locking)
  const rows = await supabaseGet(
    `brain_manifest?workspace_id=eq.${workspaceId}&is_core=eq.true&is_forked=eq.false&select=path,content_hash,updated_at`,
  );

  if (!rows || rows.length === 0) {
    // Update last check time even if nothing to check
    brainState.lastForkCheck = new Date().toISOString();
    saveBrainState(brainState);
    return;
  }

  let forkedCount = 0;

  for (const row of rows) {
    const localPath = join(monorepoRoot, '.claude', row.path);

    // Skip files that don't exist locally (not yet bootstrapped)
    if (!existsSync(localPath)) {
      continue;
    }

    // mtime filter: skip files not modified since last check
    try {
      const stat = statSync(localPath);
      const mtimeMs = stat.mtimeMs;
      if (lastCheckMs > 0 && mtimeMs < lastCheckMs) {
        continue; // File hasn't been touched since last check
      }
    } catch {
      continue; // Can't stat — skip
    }

    // Compute hash and compare
    let content;
    try {
      content = readFileSync(localPath, 'utf8');
    } catch {
      continue; // Can't read — skip
    }

    const localHash = computeContentHash(content);

    // Skip entries with pending hash — waiting for bootstrap to populate real hash
    if (row.content_hash === 'pending') {
      // Bootstrap hasn't regenerated this file yet — update hash from current content
      // Use optimistic locking: only update if row hasn't been modified concurrently
      const matchParams = { workspace_id: workspaceId, path: row.path };
      if (row.updated_at) matchParams.updated_at = row.updated_at;
      await supabasePatch('brain_manifest', matchParams, {
        content_hash: localHash,
        updated_at: new Date().toISOString(),
      });
      continue;
    }

    if (localHash !== row.content_hash) {
      // File has been modified locally — mark as forked
      // Use optimistic locking to prevent race with apply-updates
      const matchParams = { workspace_id: workspaceId, path: row.path };
      if (row.updated_at) matchParams.updated_at = row.updated_at;
      const ok = await supabasePatch('brain_manifest', matchParams, {
        is_forked: true,
        forked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (ok) forkedCount++;
    }
  }

  // Update last check timestamp
  brainState.lastForkCheck = new Date().toISOString();
  saveBrainState(brainState);

  if (forkedCount > 0) {
    // Only notify if there are NEW forks since last notification
    const lastNotifiedForkCount = brainState.lastNotifiedForkCount || 0;
    const totalForked = (brainState.totalForkedCount || 0) + forkedCount;
    brainState.totalForkedCount = totalForked;

    if (totalForked > lastNotifiedForkCount) {
      const newForks = totalForked - lastNotifiedForkCount;
      process.stderr.write(
        `[brain-fork] ${newForks} new CORE file${newForks === 1 ? '' : 's'} detected as forked (${totalForked} total).\n`,
      );
      brainState.lastNotifiedForkCount = totalForked;
    }
  }
}

main().catch(() => {
  // Fail silently — don't break session start
  process.exit(0);
});
