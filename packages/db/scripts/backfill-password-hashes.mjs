#!/usr/bin/env node

/**
 * Backfill password hashes for portfolio_passwords rows that have NULL password_hash.
 * Calls the Edge Function in "hash" mode for each unhashed row, then updates the row.
 *
 * Usage:
 *   node packages/db/scripts/backfill-password-hashes.mjs
 *
 * Requires:
 *   - Supabase running (or prod URL in apps/platform/.env.local)
 *   - A valid auth session (uses service role key for DB, but Edge Function needs user auth)
 *
 * Since we can't call the Edge Function with a service role key, this script
 * uses Web Crypto directly (same algorithm as the Edge Function) to generate
 * PBKDF2-SHA256 hashes locally.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { webcrypto } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(__dirname, '../../..');

// Load env from both web and admin .env files
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    let val = trimmed.slice(eq + 1);
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

// portfolio_passwords lives in the web app's Supabase project
loadEnvFile(resolve(MONOREPO_ROOT, 'apps/web/.env.local'));
loadEnvFile(resolve(MONOREPO_ROOT, 'apps/web/.env'));

const supabaseUrl = process.env.VITE_SUPABASE_URL;
// Service role key for the web project (needed for write access)
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for the web project.');
  console.error(
    'The portfolio_passwords table lives in the web app Supabase project (oabazxgxaaxvizebwzev).',
  );
  console.error('Add SUPABASE_SERVICE_ROLE_KEY to apps/web/.env.local to run this script.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// PBKDF2-SHA256 hash (mirrors Edge Function)
async function createPasswordHash(password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const keyMaterial = await webcrypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const hashHex = Array.from(new Uint8Array(derivedBits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${saltHex}:${hashHex}`;
}

async function main() {
  // Find rows with NULL password_hash
  const { data: rows, error } = await supabase
    .from('portfolio_passwords')
    .select('id, project_id, project_title, password')
    .is('password_hash', null);

  if (error) {
    console.error('Failed to fetch rows:', error.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log('All rows already have password_hash. Nothing to backfill.');
    return;
  }

  console.log(`Found ${rows.length} row(s) needing backfill.`);

  for (const row of rows) {
    const hash = await createPasswordHash(row.password);
    const { error: updateError } = await supabase
      .from('portfolio_passwords')
      .update({ password_hash: hash })
      .eq('id', row.id);

    if (updateError) {
      console.error(`Failed to update row ${row.id}: ${updateError.message}`);
    } else {
      console.log(`Backfilled: ${row.project_title} (${row.id.slice(0, 8)})`);
    }
  }

  console.log('Backfill complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
