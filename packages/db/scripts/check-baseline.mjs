#!/usr/bin/env node
// Checks that schema/baseline/0001_baseline.sql still matches schema/migrations.
//
// The baseline records every migration it covers in public._migrations with the first 16 hex
// characters of the file's sha256 (the hash generate-baseline.mjs writes). A fresh install skips
// those files, so editing one after the baseline was generated would reach existing databases
// and never reach fresh ones. This fails when a recorded file changed or no longer exists.
// Migration files newer than the baseline are listed; boot-local.sh applies them after it.
//
// Usage: node packages/db/scripts/check-baseline.mjs
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../schema');
const MIGRATIONS_DIR = path.join(SCHEMA_DIR, 'migrations');
const BASELINE = path.join(SCHEMA_DIR, 'baseline/0001_baseline.sql');

const hash = (file) =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);

const baseline = fs.readFileSync(BASELINE, 'utf8');
const recorded = [...baseline.matchAll(/^ {2}\('([^']+\.sql)', '([0-9a-f]{16})', 'baseline'\)/gm)];
if (recorded.length === 0) {
  console.error(`No recorded migrations found in ${path.relative(process.cwd(), BASELINE)}.`);
  process.exit(1);
}

const problems = [];
for (const [, filename, expected] of recorded) {
  const file = path.join(MIGRATIONS_DIR, filename);
  if (!fs.existsSync(file)) {
    problems.push(`${filename}: recorded in the baseline but the file is missing`);
    continue;
  }
  const actual = hash(file);
  if (actual !== expected) {
    problems.push(`${filename}: baseline hash ${expected}, file hash ${actual}`);
  }
}

const covered = new Set(recorded.map(([, filename]) => filename));
const newer = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql') && !covered.has(f))
  .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));

console.log(`Baseline covers ${recorded.length} migration files.`);
console.log(
  `Applied after the baseline on a fresh install: ${newer.length ? newer.join(', ') : 'none'}`,
);
if (problems.length > 0) {
  console.error(`\n${problems.length} recorded migration(s) no longer match the baseline:`);
  for (const line of problems) console.error(`  ${line}`);
  console.error(
    '\nFresh installs skip recorded files. Revert the edit and add a new migration instead,',
  );
  console.error('or regenerate the baseline with packages/db/scripts/generate-baseline.mjs.');
  process.exit(1);
}
console.log('Every recorded hash matches its migration file.');
