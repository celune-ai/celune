#!/usr/bin/env node
/**
 * migrate.mjs — SQL migration runner for Supabase
 *
 * Scans packages/db/schema/migrations/ for .sql files, compares against
 * a _migrations tracking table in Supabase, and applies pending migrations
 * via the Supabase REST API (no direct Postgres connection needed).
 *
 * Usage:
 *   node packages/db/scripts/migrate.mjs              # interactive — list pending, prompt to apply
 *   node packages/db/scripts/migrate.mjs --dry-run    # show pending without applying
 *   node packages/db/scripts/migrate.mjs --auto-apply # apply all pending without prompting
 *   node packages/db/scripts/migrate.mjs --status     # show migration history + pending
 *   node packages/db/scripts/migrate.mjs --backfill  # mark already-applied migrations as tracked
 *   node packages/db/scripts/migrate.mjs --auto-apply --continue-on-error  # apply all, skip "already exists" errors
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../schema/migrations');

// ---------------------------------------------------------------------------
// Config — reads from apps/platform/.env.local
// ---------------------------------------------------------------------------
function loadEnv() {
  // Prefer process.env (CI, scripts) over .env.local (local dev)
  const env = { ...process.env };
  try {
    const envPath = resolve(__dirname, '../../../apps/platform/.env.local');
    const lines = readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        // Don't override process.env values — they take precedence
        if (!env[key]) env[key] = match[2].trim();
      }
    }
  } catch {
    // .env.local may not exist (CI) — that's fine if process.env has the values
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in apps/platform/.env.local',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Supabase SQL execution via REST RPC
// ---------------------------------------------------------------------------
async function executeSql(sql) {
  // Use the Supabase REST API to run arbitrary SQL via the pg_net extension
  // or the PostgREST RPC endpoint. We'll use the /rest/v1/rpc endpoint
  // with a custom function, but first try direct SQL via the management API.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    // If exec_sql doesn't exist, fall back to creating it first
    if (res.status === 404) {
      return null; // Signal to create the function
    }
    const text = await res.text();
    throw new Error(`SQL execution failed (${res.status}): ${text}`);
  }

  return res.json();
}

async function runSql(sql) {
  // Strip transaction commands — exec_sql runs inside its own transaction
  // and PostgreSQL doesn't support nested BEGIN/COMMIT via EXECUTE
  sql = sql.replace(/^\s*BEGIN\s*;\s*/im, '').replace(/\s*COMMIT\s*;\s*$/im, '');

  // Try the exec_sql RPC first
  let result = await executeSql(sql);

  if (result === null) {
    // Create the exec_sql function, then retry
    console.log('Creating exec_sql helper function...');
    const createFn = `
      CREATE OR REPLACE FUNCTION exec_sql(query text)
      RETURNS json
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$
      DECLARE
        result json;
      BEGIN
        EXECUTE query;
        result := json_build_object('success', true);
        RETURN result;
      EXCEPTION WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', SQLERRM);
      END;
      $$;
    `;
    // Bootstrap: use PostgREST to create the function
    // We need to use the Supabase SQL Editor API or MCP
    // Fall back to using the query endpoint directly
    const bootstrapRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: createFn }),
    });

    if (!bootstrapRes.ok) {
      console.error('Cannot bootstrap exec_sql function. You may need to create it manually:');
      console.error(createFn);
      console.error('\nAlternatively, run migrations via the Supabase SQL Editor.');
      process.exit(1);
    }

    result = await executeSql(sql);
    if (result === null) {
      throw new Error('exec_sql function creation succeeded but still returns 404');
    }
  }

  if (result && result.success === false) {
    throw new Error(result.error || 'SQL execution failed');
  }

  return result;
}

// Query helper — returns rows via PostgREST
async function query(table, params = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) {
    if (res.status === 404) return null; // Table doesn't exist
    const text = await res.text();
    throw new Error(`Query failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Migration tracking table
// ---------------------------------------------------------------------------
async function ensureMigrationsTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS _migrations (
      id serial PRIMARY KEY,
      filename text NOT NULL UNIQUE,
      hash text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      applied_by text NOT NULL DEFAULT 'rick'
    );
  `;
  await runSql(sql);
}

async function getAppliedMigrations() {
  const rows = await query('_migrations', '?select=filename,hash,applied_at&order=applied_at.asc');
  if (rows === null) return []; // Table doesn't exist yet
  return rows;
}

async function recordMigration(filename, hash, appliedBy = 'rick') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/_migrations`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ filename, hash, applied_by: appliedBy }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to record migration (${res.status}): ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Local migration files
// ---------------------------------------------------------------------------
function getLocalMigrations() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  return files.map((filename) => {
    const content = readFileSync(resolve(MIGRATIONS_DIR, filename), 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    return { filename, content, hash };
  });
}

// ---------------------------------------------------------------------------
// Backfill — detect already-applied migrations by checking schema objects
// ---------------------------------------------------------------------------

/**
 * Parse a migration SQL file and extract the objects it creates/modifies.
 * Returns an array of check descriptors: { type, check_sql }
 * where check_sql returns rows if the object EXISTS.
 */
function extractSchemaObjects(sql) {
  const checks = [];

  // Validate identifiers before using in SQL — must be alphanumeric/underscore only
  const isValidIdentifier = (name) => /^\w+$/.test(name);

  // Strip SQL comments for cleaner matching
  const cleaned = sql
    .replace(/--[^\n]*/g, '') // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ''); // block comments

  // Multi-line regex matches across the full SQL text
  for (const m of cleaned.matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)/gi,
  )) {
    if (!isValidIdentifier(m[1])) continue;
    checks.push({
      type: 'table',
      name: m[1],
      check_sql: `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='${m[1]}'`,
    });
  }

  for (const m of cleaned.matchAll(
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(/gi,
  )) {
    if (!isValidIdentifier(m[1])) continue;
    checks.push({
      type: 'function',
      name: m[1],
      check_sql: `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public' AND p.proname='${m[1]}'`,
    });
  }

  for (const m of cleaned.matchAll(
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi,
  )) {
    if (!isValidIdentifier(m[1])) continue;
    checks.push({
      type: 'index',
      name: m[1],
      check_sql: `SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='${m[1]}'`,
    });
  }

  for (const m of cleaned.matchAll(/CREATE\s+TYPE\s+(?:public\.)?(\w+)/gi)) {
    if (!isValidIdentifier(m[1])) continue;
    checks.push({
      type: 'type',
      name: m[1],
      check_sql: `SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace=n.oid WHERE n.nspname='public' AND t.typname='${m[1]}'`,
    });
  }

  for (const m of cleaned.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(\w+)/gi)) {
    if (!isValidIdentifier(m[1])) continue;
    checks.push({
      type: 'trigger',
      name: m[1],
      check_sql: `SELECT 1 FROM information_schema.triggers WHERE trigger_schema='public' AND trigger_name='${m[1]}'`,
    });
  }

  // Per-line checks for ALTER TABLE ADD COLUMN (typically single-line)
  const lines = sql.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--') || trimmed.startsWith('/*')) continue;

    const addColumn = trimmed.match(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)\s+ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i,
    );
    if (addColumn && isValidIdentifier(addColumn[1]) && isValidIdentifier(addColumn[2])) {
      checks.push({
        type: 'column',
        name: `${addColumn[1]}.${addColumn[2]}`,
        check_sql: `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${addColumn[1]}' AND column_name='${addColumn[2]}'`,
      });
    }
  }

  // Deduplicate by name
  const seen = new Set();
  return checks.filter((c) => {
    const key = `${c.type}:${c.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Check if a schema object exists using exec_sql.
 * Wraps the check query in a DO block that raises an error if NOT found,
 * so we can distinguish "exists" (success) from "missing" (error).
 */
async function objectExists(checkSql) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `DO $$ BEGIN IF NOT EXISTS (${checkSql}) THEN RAISE EXCEPTION 'not_found'; END IF; END $$;`,
      }),
    });

    if (!res.ok) return false;
    const data = await res.json();
    return data && data.success !== false;
  } catch {
    return false;
  }
}

/**
 * More reliable object existence check via PostgREST for tables.
 */
async function tableExists(tableName) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?select=*&limit=0`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  // 200 = table exists, 404/PGRST205 = doesn't exist
  return res.ok;
}

/**
 * Check if a function exists via RPC probe.
 */
async function functionExists(funcName) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${funcName}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const text = await res.text();
  // PGRST202 = function not found; anything else means it exists (even if call fails)
  return !text.includes('PGRST202');
}

/**
 * Check if a column exists on a table via PostgREST select.
 */
async function columnExists(tableName, columnName) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?select=${columnName}&limit=0`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) return false;
  const text = await res.text();
  return !text.includes('42703'); // column does not exist error
}

/**
 * Run backfill: for each untracked migration, check if its schema objects
 * already exist and mark it as applied if so.
 */
async function runBackfill(pending) {
  let backfilled = 0;
  let skipped = 0;
  let uncertain = 0;

  for (const m of pending) {
    const objects = extractSchemaObjects(m.content);

    if (objects.length === 0) {
      // Can't determine what this migration does — mark uncertain
      console.log(`  ? ${m.filename}  (no parseable objects — skipping)`);
      uncertain++;
      continue;
    }

    // Check each object
    let allExist = true;
    let anyChecked = false;
    for (const obj of objects) {
      let exists = false;
      if (obj.type === 'table') {
        exists = await tableExists(obj.name);
      } else if (obj.type === 'function') {
        exists = await functionExists(obj.name);
      } else if (obj.type === 'column') {
        const [table, col] = obj.name.split('.');
        exists = await columnExists(table, col);
      } else {
        // For indexes, triggers, types — use exec_sql probe
        exists = await objectExists(obj.check_sql);
      }
      anyChecked = true;
      if (!exists) {
        allExist = false;
        break;
      }
    }

    if (!anyChecked) {
      console.log(`  ? ${m.filename}  (no checkable objects — skipping)`);
      uncertain++;
      continue;
    }

    if (allExist) {
      await recordMigration(m.filename, m.hash, 'backfill');
      console.log(`  ✓ ${m.filename}  (backfilled — objects exist)`);
      backfilled++;
    } else {
      console.log(`  → ${m.filename}  (pending — objects missing)`);
      skipped++;
    }
  }

  return { backfilled, skipped, uncertain };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const autoApply = args.includes('--auto-apply');
  const statusOnly = args.includes('--status');
  const backfill = args.includes('--backfill');
  const continueOnError = args.includes('--continue-on-error');

  console.log('Migration Runner — Supabase REST API');
  console.log('─'.repeat(40));

  // Ensure tracking table exists
  try {
    await ensureMigrationsTable();
  } catch (err) {
    console.error('Failed to create _migrations table:', err.message);
    console.error('\nThe migration runner needs an exec_sql() function in your database.');
    console.error('Create it via the Supabase SQL Editor, then retry.');
    process.exit(1);
  }

  // Get applied migrations
  const applied = await getAppliedMigrations();
  const appliedSet = new Map(applied.map((m) => [m.filename, m]));

  // Get local migrations (needed for status, backfill, and normal runs)
  const local = getLocalMigrations();
  const pending = local.filter((m) => !appliedSet.has(m.filename));

  if (statusOnly) {
    console.log(`\nLocal:   ${local.length}`);
    console.log(`Applied: ${applied.length}`);
    console.log(`Pending: ${pending.length}`);
    if (applied.length > 0) {
      console.log('\nApplied migrations:');
      for (const m of applied) {
        console.log(`  ✓ ${m.filename}  (${m.applied_at.slice(0, 10)})`);
      }
    }
    if (pending.length > 0) {
      console.log('\nPending migrations:');
      for (const m of pending) {
        console.log(`  → ${m.filename}  (${m.hash})`);
      }
    }
    // Check for hash mismatches
    for (const m of local) {
      const applied_m = appliedSet.get(m.filename);
      if (applied_m && applied_m.hash !== m.hash) {
        console.warn(`\n⚠ ${m.filename} was modified after being applied (hash mismatch)`);
      }
    }
    if (pending.length === 0) console.log('\n✓ All migrations are up to date.');
    process.exit(pending.length > 0 ? 1 : 0);
  }

  if (backfill) {
    // Warn about hash mismatches before backfilling
    for (const m of local) {
      const applied_m = appliedSet.get(m.filename);
      if (applied_m && applied_m.hash !== m.hash) {
        console.warn(`⚠ ${m.filename} has been modified since it was applied (hash mismatch)`);
      }
    }
    console.log(
      `\nBackfill mode — checking ${pending.length} untracked migrations against live schema...\n`,
    );
    if (pending.length === 0) {
      console.log('✓ Nothing to backfill — all migrations are tracked.');
      return;
    }
    const result = await runBackfill(pending);
    console.log(`\n${'─'.repeat(40)}`);
    console.log(
      `Backfill complete: ${result.backfilled} tracked, ${result.skipped} pending, ${result.uncertain} uncertain`,
    );
    if (result.skipped > 0) {
      console.log('\nRun without --backfill to apply the remaining pending migrations.');
    }
    if (result.uncertain > 0) {
      console.log('Uncertain migrations may need manual verification or --auto-apply.');
    }
    return;
  }

  // Check for hash mismatches (modified after apply)
  for (const m of local) {
    const applied_m = appliedSet.get(m.filename);
    if (applied_m && applied_m.hash !== m.hash) {
      console.warn(`⚠ ${m.filename} was modified after being applied (hash mismatch)`);
    }
  }

  console.log(`\nLocal migrations: ${local.length}`);
  console.log(`Already applied:  ${applied.length}`);
  console.log(`Pending:          ${pending.length}`);

  if (pending.length === 0) {
    console.log('\n✓ All migrations are up to date.');
    return;
  }

  console.log('\nPending migrations:');
  for (const m of pending) {
    console.log(`  → ${m.filename}  (${m.hash})`);
  }

  if (dryRun) {
    console.log('\n(dry run — no changes applied)');
    return;
  }

  // Apply each migration
  let failCount = 0;
  for (const m of pending) {
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`Migration: ${m.filename}`);

    if (!autoApply) {
      const lines = m.content.split('\n').length;
      console.log(`  ${lines} lines of SQL`);

      const answer = await prompt('  Apply? [y]es / [s]how sql / [n]o > ');

      if (answer === 's' || answer === 'show') {
        console.log('\n' + m.content + '\n');
        const confirm = await prompt('  Apply this migration? [y/n] > ');
        if (confirm !== 'y' && confirm !== 'yes') {
          console.log('  Skipped.');
          continue;
        }
      } else if (answer !== 'y' && answer !== 'yes') {
        console.log('  Skipped.');
        continue;
      }
    }

    try {
      await runSql(m.content);
      await recordMigration(m.filename, m.hash);
      console.log(`  ✓ Applied: ${m.filename}`);
    } catch (err) {
      const msg = err.message || '';
      // Detect "already exists" errors — migration was already applied
      const alreadyApplied =
        /already exists|is not an existing enum label|duplicate key|cannot be renamed/i.test(msg);

      if (alreadyApplied && (continueOnError || autoApply)) {
        try {
          await recordMigration(m.filename, m.hash, 'backfill');
        } catch (recordErr) {
          // Ignore duplicate key — migration already tracked
          if (!recordErr.message.includes('409') && !recordErr.message.includes('duplicate'))
            throw recordErr;
        }
        console.log(`  ⊘ ${m.filename}  (already applied — recorded as backfill)`);
        console.log(`    ${msg}`);
      } else {
        console.error(`  ✗ Failed: ${m.filename}`);
        console.error(`    ${msg}`);
        if (continueOnError) {
          failCount++;
          continue;
        }
        if (!autoApply) {
          const cont = await prompt('  Continue with remaining migrations? [y/n] > ');
          if (cont !== 'y' && cont !== 'yes') {
            console.log('Aborting.');
            process.exit(1);
          }
        } else {
          console.error('Aborting (--auto-apply does not continue on failure).');
          process.exit(1);
        }
      }
    }
  }

  console.log(`\n${'─'.repeat(40)}`);
  if (failCount > 0) {
    console.log(`Migration run complete with ${failCount} failure(s).`);
    process.exit(1);
  } else {
    console.log('Migration run complete.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
