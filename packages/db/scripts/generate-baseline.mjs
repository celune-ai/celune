#!/usr/bin/env node
// Regenerates schema/baseline/0001_baseline.sql from a database that boot-local.sh has brought
// fully up to date with the incremental migrations.
//
// Usage:
//   DATABASE_URL=postgresql://... packages/db/scripts/boot-local.sh    # on an empty Supabase database
//   DATABASE_URL=postgresql://... node packages/db/scripts/generate-baseline.mjs
//   node packages/db/scripts/generate-baseline.mjs path/to/dump.sql     # from an existing dump:
//     pg_dump "$DATABASE_URL" --schema=public --no-owner -f path/to/dump.sql
// BASELINE_OUT=path writes somewhere other than schema/baseline/0001_baseline.sql.
//
// Needs pg_dump 17 or later on PATH. The baseline holds the public schema (tables, functions,
// policies, grants) and rows only for SEED_TABLES, which the seed migrations fill. With
// DATABASE_URL, pg_dump reads no other table's rows. A dump file with rows in any other table
// is refused: it came from a database that has user data, not from a fresh boot. Objects Celune
// creates in Supabase-managed schemas (the auth.users trigger, the storage bucket and its
// policies, the realtime publication, the pg_cron job) are not part of a public-schema dump, so
// they are appended from the migrations that define them.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../schema');
const MIGRATIONS_DIR = path.join(SCHEMA_DIR, 'migrations');
const OUT = process.env.BASELINE_OUT
  ? path.resolve(process.env.BASELINE_OUT)
  : path.join(SCHEMA_DIR, 'baseline/0001_baseline.sql');

// Tables whose rows a fresh install needs, and the migrations that insert them.
const SEED_TABLES = [
  'cron_jobs', // 005-cron-jobs.sql
  'feature_flags', // 20260326_gated_signup.sql
  'permissions', // 20260306_rbac_v2_core_tables.sql, 20260310_granular_permissions_keys.sql
  'roles', // 20260306_rbac_v2_core_tables.sql, 20260310_org_role_seeding_trigger.sql
  'role_permissions', // the same three, plus 20260310_granular_permissions_keys.sql
];

const dumpFile = process.argv[2];
const url = process.env.DATABASE_URL;
if (!dumpFile && !url) {
  console.error(
    'Set DATABASE_URL to a database booted with boot-local.sh, or pass a pg_dump file.',
  );
  process.exit(1);
}

const pgDump = (...args) =>
  execFileSync('pg_dump', [url, '--schema=public', '--no-owner', ...args], {
    maxBuffer: 256 * 1024 * 1024,
  }).toString();

// Schema before data, seed rows, then indexes, constraints, triggers, and policies: the order a
// full pg_dump uses, without reading rows from any other table.
const dump = dumpFile
  ? fs.readFileSync(dumpFile, 'utf8')
  : [
      pgDump('--section=pre-data'),
      pgDump('--data-only', ...SEED_TABLES.map((t) => `--table=public.${t}`)),
      pgDump('--section=post-data'),
    ].join('\n');

const lines = dump.split('\n');
const kept = [];
const unexpectedRows = new Set();
let skippingCopy = null;
for (const line of lines) {
  if (skippingCopy) {
    if (line === '\\.') skippingCopy = null;
    else if (skippingCopy !== '_migrations') unexpectedRows.add(skippingCopy);
    continue;
  }
  // Rows only for seed tables. _migrations rows are regenerated below from the files on disk.
  const copy = /^COPY public\.(\w+) /.exec(line);
  if (copy && !SEED_TABLES.includes(copy[1])) {
    skippingCopy = copy[1];
    continue;
  }
  if (/^\\(un)?restrict /.test(line)) continue; // psql 17.6+ only
  if (line === 'SET transaction_timeout = 0;') continue; // Postgres 17+ only
  if (line === 'CREATE SCHEMA public;') continue;
  if (line.startsWith('COMMENT ON SCHEMA public ')) continue;
  // Only supabase_admin can change its own default privileges; Supabase sets these already.
  if (line.startsWith('ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ')) continue;
  if (
    line.startsWith('-- Dumped from database version') ||
    line.startsWith('-- Dumped by pg_dump version')
  )
    continue;
  kept.push(line);
}

if (unexpectedRows.size > 0) {
  console.error(
    `The dump has rows in ${[...unexpectedRows].sort().join(', ')}. The baseline takes rows only ` +
      `from ${SEED_TABLES.join(', ')}. Dump a database that boot-local.sh built from empty.`,
  );
  process.exit(1);
}

function between(file, start, end) {
  const src = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  const a = src.indexOf(start);
  const b = src.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`Cannot find ${start} ... ${end} in ${file}`);
  return src.slice(a, b + end.length);
}

const cronBlock = between('20260331_ai_job_queue.sql', 'DO $cron$', '\n$cron$;');
const storageBlock = between(
  '20260329_feedback_popover_fields.sql',
  'INSERT INTO storage.buckets',
  "USING (bucket_id = 'feedback-screenshots');",
);

const files = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
const hash = (f) =>
  createHash('sha256')
    .update(fs.readFileSync(path.join(MIGRATIONS_DIR, f)))
    .digest('hex')
    .slice(0, 16);
const migrationRows = files.map((f) => `  ('${f}', '${hash(f)}', 'baseline')`).join(',\n');

const header = `-- Celune schema baseline for fresh installs.
--
-- Generated by packages/db/scripts/generate-baseline.mjs from a Supabase database that had
-- supabase-schema.sql and every file in schema/migrations applied. Do not edit by hand;
-- regenerate after adding migrations if fresh installs should skip them.
--
-- boot-local.sh applies this file only to a database with no public tables, then records every
-- migration listed at the bottom as applied, then applies any newer migration files in order.
-- Existing databases keep using the incremental files.
--
-- Requires the Supabase roles and schemas (auth, storage, extensions, cron when available).

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Supabase grants anon, authenticated, and service_role access to every new object in public by
-- default. The dump below lists the grants each object should end with, including objects the
-- migrations locked down (exec_sql, for example), so those defaults are off while it runs. The
-- dump's DEFAULT PRIVILEGES section near the end turns them back on.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
`;

const footer = `
--
-- Objects in Supabase-managed schemas
--

SET search_path = public, extensions;

-- New sign-ups get a member role (027-handle-new-user-trigger.sql)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Feedback screenshots bucket (20260329_feedback_popover_fields.sql)
${storageBlock}

-- Realtime (supabase-schema.sql)
DO $realtime$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks, public.activity_log;
  END IF;
END $realtime$;

-- Job queue cleanup schedule (20260331_ai_job_queue.sql)
${cronBlock}

--
-- Migrations covered by this baseline
--

INSERT INTO public._migrations (filename, hash, applied_by) VALUES
${migrationRows}
ON CONFLICT (filename) DO NOTHING;
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, header + kept.join('\n') + footer);
console.log(`Wrote ${path.relative(process.cwd(), OUT)} covering ${files.length} migrations.`);
