#!/usr/bin/env node

/**
 * brain-apply-updates.mjs — Apply pending CORE brain manifest updates
 *
 * Called by the session-start hook to auto-apply non-forked updates.
 * Uses Supabase REST API directly with service role key (no admin app auth needed).
 *
 * Usage:
 *   node packages/db/scripts/brain-apply-updates.mjs --workspace-id <uuid>
 *
 * Exit codes:
 *   0 — success (updates applied or nothing to do)
 *   1 — error (missing args, network failure, etc.)
 *
 * Outputs to stderr only (stdout is reserved for structured data if needed).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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
  process.stderr.write('[brain] Missing or invalid --workspace-id\n');
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
    process.stderr.write('[brain] Cannot read env file, skipping update check\n');
    process.exit(0);
  }
}

if (!supabaseUrl || !serviceKey) {
  process.exit(0); // Silently skip — no credentials available
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
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 1. Fetch rows with update_available=true for this workspace
  const rows = await supabaseGet(
    `brain_manifest?workspace_id=eq.${workspaceId}&update_available=eq.true&is_core=eq.true&select=path,version,is_forked,content_hash`,
  );

  if (!rows || rows.length === 0) {
    return; // Nothing to do
  }

  const nonForked = rows.filter((r) => !r.is_forked);
  const forked = rows.filter((r) => r.is_forked);

  // 2. Auto-apply non-forked updates
  //    Mark update_available=false. The actual content/version was already
  //    set by the update-detection pipeline when it flagged update_available.
  //    This hook just acknowledges the update was seen and applied.
  let appliedCount = 0;
  for (const row of nonForked) {
    const ok = await supabasePatch(
      'brain_manifest',
      { workspace_id: workspaceId, path: row.path },
      {
        update_available: false,
        updated_at: new Date().toISOString(),
      },
    );
    if (ok) appliedCount++;
  }

  if (appliedCount > 0) {
    process.stderr.write(
      `[brain] ${appliedCount} CORE update${appliedCount === 1 ? '' : 's'} applied.\n`,
    );
  }

  // 3. Notify about forked updates (cannot auto-apply)
  //    Only show if count has changed since last session to prevent repeat notifications.
  if (forked.length > 0) {
    const brainStateDir = join(monorepoRoot, '.claude');
    const brainStatePath = join(brainStateDir, '.brain-state.json');
    let brainState = {};
    try {
      brainState = JSON.parse(readFileSync(brainStatePath, 'utf8'));
    } catch {
      /* no state yet */
    }

    const lastForkedUpdateCount = brainState.lastForkedUpdateNotifyCount || 0;
    if (forked.length !== lastForkedUpdateCount) {
      process.stderr.write(
        `[brain] ${forked.length} CORE update${forked.length === 1 ? '' : 's'} available for forked files. Run /build to review.\n`,
      );
      brainState.lastForkedUpdateNotifyCount = forked.length;
      try {
        mkdirSync(brainStateDir, { recursive: true });
        writeFileSync(brainStatePath, JSON.stringify(brainState, null, 2) + '\n');
      } catch {
        /* non-fatal */
      }
    }
  }
}

main().catch(() => {
  // Fail silently — don't break session start
  process.exit(0);
});
