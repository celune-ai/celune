#!/usr/bin/env node
/**
 * migrate-production.mjs: strict migration runner for a hosted database (Celune Cloud).
 *
 * Usage (DATABASE_URL must be set; it is never printed):
 *   node packages/db/scripts/migrate-production.mjs --plan    # list pending files, change nothing
 *   node packages/db/scripts/migrate-production.mjs --apply   # apply pending files in order
 *
 * Unlike migrate.mjs and boot-local.sh, it tolerates no SQL errors and never creates helper
 * functions. Each pending file runs with ON_ERROR_STOP in one transaction together with its
 * public._migrations row, so a failed file leaves nothing behind and the run stops there.
 * Enum ADD VALUE statements commit first, on their own, because Postgres cannot use a new enum
 * value inside the transaction that added it.
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  enumPreStatements,
  hasOwnTransaction,
  planMigrations,
  recordSql,
} from './lib/migration-plan.mjs';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../schema/migrations');
const PSQL = process.env.PSQL || 'psql';

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function psql(args, input) {
  const res = spawnSync(
    PSQL,
    [process.env.DATABASE_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args],
    {
      encoding: 'utf-8',
      input,
      env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' },
    },
  );
  if (res.error) fail(`could not run ${PSQL}: ${res.error.message}`);
  return res;
}

function appliedRows() {
  const exists = psql(['-tA', '-c', "select to_regclass('public._migrations') is not null"]);
  if (exists.status !== 0) fail(`cannot connect to the database:\n${exists.stderr.trim()}`);
  if (exists.stdout.trim() !== 't') {
    fail(
      'public._migrations does not exist; boot this database with boot-local.sh or the baseline first',
    );
  }
  const res = psql(['-tA', '-F', '\t', '-c', 'select filename, hash from public._migrations']);
  if (res.status !== 0) fail(`cannot read public._migrations:\n${res.stderr.trim()}`);
  return res.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [filename, hash] = line.split('\t');
      return { filename, hash };
    });
}

function applyFile(file, workDir) {
  for (const statement of enumPreStatements(file.content)) {
    const pre = psql(['-c', statement]);
    if (pre.status !== 0) return pre;
  }
  const recordPath = join(workDir, 'record.sql');
  writeFileSync(recordPath, recordSql(file.filename, file.hash));
  const path = join(MIGRATIONS_DIR, file.filename);
  if (hasOwnTransaction(file.content)) {
    const res = psql(['-f', path]);
    return res.status !== 0 ? res : psql(['-f', recordPath]);
  }
  return psql(['--single-transaction', '-f', path, '-f', recordPath]);
}

function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--apply') ? 'apply' : args.includes('--plan') ? 'plan' : null;
  if (!mode || args.length !== 1) fail('pass exactly one of --plan or --apply');
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set');

  const local = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((filename) => ({
      filename,
      content: readFileSync(join(MIGRATIONS_DIR, filename), 'utf-8'),
    }));
  const { pending, mismatched } = planMigrations(local, appliedRows());

  for (const m of mismatched) {
    console.warn(
      `⚠ ${m.filename} changed after it was applied (recorded ${m.recorded}, local ${m.local}); not re-run`,
    );
  }
  console.log(`${local.length} migration files, ${pending.length} pending`);
  for (const p of pending) console.log(`  • ${p.filename}  ${p.hash}`);

  if (mode === 'plan' || pending.length === 0) {
    console.log(mode === 'plan' ? '\n(plan only; nothing applied)' : '\nNothing to apply.');
    return;
  }

  const workDir = mkdtempSync(join(tmpdir(), 'celune-migrate-'));
  try {
    for (const file of pending) {
      const res = applyFile(file, workDir);
      if (res.status !== 0) {
        console.error(res.stderr.trim());
        fail(`${file.filename} failed and was rolled back; later files were not attempted`);
      }
      console.log(`  ✓ ${file.filename}`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  console.log(`\nApplied ${pending.length} migrations.`);
}

main();
