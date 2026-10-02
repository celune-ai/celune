#!/usr/bin/env node

/**
 * Create a new project in Supabase
 * Usage: node packages/db/scripts/create-project.mjs --name "..." --description "..."
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(__dirname, '../../..');

// Load env from apps/platform/.env.local
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

// Arg parsing
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
      }
    }
  }

  return flags;
}

async function main() {
  const flags = parseArgs(process.argv);
  const name = flags.name;
  const description = flags.description;

  if (!name) {
    console.error(
      'Usage: node packages/db/scripts/create-project.mjs --name "..." --description "..."',
    );
    process.exit(1);
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({
      name,
      description: description || null,
      status: 'active',
      metadata: {},
    })
    .select()
    .single();

  if (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exit(1);
  }

  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
