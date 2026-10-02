#!/usr/bin/env node

/**
 * Backfill completion metadata for done tasks.
 *
 * For each done task:
 *   - If completed_at is missing: sets it to updated_at
 *   - If metadata.completed_by is missing: sets it to the task's assignee
 *   - If metadata.work_completed_at is missing: sets it to completed_at (or updated_at fallback)
 *
 * Usage:
 *   node packages/db/scripts/backfill-completion.mjs [--dry-run]
 *
 * Requires env vars (reads from apps/platform/.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
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
// Arg parsing
// ---------------------------------------------------------------------------

const isDryRun = process.argv.includes('--dry-run');

if (isDryRun) {
  console.log('[DRY RUN] No changes will be written.\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Fetch all done tasks
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, title, assignee, completed_at, updated_at, metadata')
    .eq('status', 'done')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch done tasks:', error.message);
    process.exit(1);
  }

  console.log(`Found ${tasks.length} done tasks. Checking for missing completion data...\n`);

  let updatedCount = 0;
  let skippedCount = 0;

  for (const task of tasks) {
    const meta = task.metadata ?? {};
    const needsCompletedAt = !task.completed_at;
    const needsCompletedBy = !meta.completed_by;
    const needsWorkCompletedAt = !meta.work_completed_at;

    if (!needsCompletedAt && !needsCompletedBy && !needsWorkCompletedAt) {
      skippedCount++;
      continue;
    }

    const updates = {};
    const changes = [];

    // Resolve the completion timestamp first — used as fallback for work_completed_at
    const completionTimestamp = task.completed_at ?? task.updated_at;

    if (needsCompletedAt) {
      updates.completed_at = task.updated_at;
      changes.push(`set completed_at to ${task.updated_at} (from updated_at)`);
    }

    // Build updated metadata once, merging all fields that need setting
    const metaChanges = {};
    if (needsCompletedBy) {
      const fallbackAgent = task.assignee ?? 'unassigned';
      metaChanges.completed_by = fallbackAgent;
      changes.push(`set metadata.completed_by to "${fallbackAgent}" (from assignee)`);
    }
    if (needsWorkCompletedAt) {
      metaChanges.work_completed_at = completionTimestamp;
      changes.push(`set metadata.work_completed_at to ${completionTimestamp}`);
    }
    if (Object.keys(metaChanges).length > 0) {
      updates.metadata = { ...meta, ...metaChanges };
    }

    const changeStr = changes.join(', ');

    if (isDryRun) {
      console.log(`[DRY RUN] Would update task "${task.title}" (${task.id}) — ${changeStr}`);
      updatedCount++;
      continue;
    }

    const { error: updateError } = await supabase.from('tasks').update(updates).eq('id', task.id);

    if (updateError) {
      console.error(`  ERROR updating task "${task.title}" (${task.id}): ${updateError.message}`);
      continue;
    }

    console.log(`Updated task "${task.title}" (${task.id}) — ${changeStr}`);
    updatedCount++;
  }

  console.log(`\nDone. Updated: ${updatedCount}, Skipped (already complete): ${skippedCount}`);
}

main().catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
