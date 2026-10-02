#!/usr/bin/env node

/**
 * Provider key rotation script.
 *
 * Re-encrypts all provider_api_keys rows from v1 to v2 encryption key.
 *
 * Prerequisites:
 *   - PROVIDER_KEY_ENCRYPTION_KEY    = old key (v1)
 *   - PROVIDER_KEY_ENCRYPTION_KEY_V2 = new key (v2)
 *   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env or .env.local
 *
 * Usage:
 *   node packages/db/scripts/rotate-provider-keys.mjs [--dry-run]
 *
 * After running:
 *   1. Verify all keys decrypt correctly (the script validates each one)
 *   2. Swap env vars: rename _V2 to PROVIDER_KEY_ENCRYPTION_KEY, remove old
 *   3. Deploy IMMEDIATELY — do NOT create new provider keys between steps 1-3.
 *      Keys inserted in that window use the old key with a v1: prefix and
 *      become undecryptable after the swap.
 */

import { createClient } from '@supabase/supabase-js';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

// Load env from .env.local if not already set
function loadEnv() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  try {
    const envPath = resolve(process.cwd(), 'apps/platform/.env.local');
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z_]+)=(.+)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim();
      }
    }
  } catch {
    // ignore
  }
}

loadEnv();

const dryRun = process.argv.includes('--dry-run');

const v1Key = process.env.PROVIDER_KEY_ENCRYPTION_KEY;
const v2Key = process.env.PROVIDER_KEY_ENCRYPTION_KEY_V2;

if (!v1Key || !/^[0-9a-f]{64}$/i.test(v1Key)) {
  console.error('ERROR: PROVIDER_KEY_ENCRYPTION_KEY must be 64 hex chars.');
  process.exit(1);
}
if (!v2Key || !/^[0-9a-f]{64}$/i.test(v2Key)) {
  console.error('ERROR: PROVIDER_KEY_ENCRYPTION_KEY_V2 must be 64 hex chars.');
  process.exit(1);
}
if (v1Key === v2Key) {
  console.error('ERROR: v1 and v2 keys are identical. Nothing to rotate.');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function decryptWithKey(keyHex, encryptedKey, iv) {
  const keyBuf = Buffer.from(keyHex, 'hex');
  let rawBase64 = encryptedKey;
  if (rawBase64.startsWith('v1:')) rawBase64 = rawBase64.slice(3);
  if (rawBase64.startsWith('v2:')) rawBase64 = rawBase64.slice(3);

  const encBuf = Buffer.from(rawBase64, 'base64');
  const ivBuf = Buffer.from(iv, 'base64');
  const ciphertext = encBuf.subarray(0, encBuf.length - AUTH_TAG_BYTES);
  const authTag = encBuf.subarray(encBuf.length - AUTH_TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, keyBuf, ivBuf);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function encryptWithKey(keyHex, plaintext) {
  const keyBuf = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyBuf, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const encBuf = Buffer.concat([ciphertext, authTag]);
  return {
    encryptedKey: `v2:${encBuf.toString('base64')}`,
    iv: iv.toString('base64'),
  };
}

async function main() {
  console.log(dryRun ? '=== DRY RUN ===' : '=== ROTATING PROVIDER KEYS ===');

  const { data: rows, error } = await supabase
    .from('provider_api_keys')
    .select('id, provider, name, encrypted_key, key_iv, key_suffix')
    .eq('is_active', true);

  if (error) {
    console.error('Failed to fetch keys:', error.message);
    process.exit(1);
  }

  console.log(`Found ${rows.length} active key(s).`);

  let rotated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const label = `${row.provider}/${row.name} (${row.id.slice(0, 8)})`;

    // Skip keys already on v2
    if (row.encrypted_key.startsWith('v2:')) {
      console.log(`  SKIP ${label} — already v2`);
      skipped++;
      continue;
    }

    try {
      // Decrypt with v1
      const plaintext = decryptWithKey(v1Key, row.encrypted_key, row.key_iv);

      // Verify suffix matches
      if (plaintext.slice(-4) !== row.key_suffix) {
        console.error(`  FAIL ${label} — suffix mismatch after decrypt`);
        failed++;
        continue;
      }

      // Re-encrypt with v2
      const { encryptedKey, iv } = encryptWithKey(v2Key, plaintext);

      // Verify round-trip
      const verified = decryptWithKey(v2Key, encryptedKey, iv);
      if (verified !== plaintext) {
        console.error(`  FAIL ${label} — round-trip verification failed`);
        failed++;
        continue;
      }

      if (dryRun) {
        console.log(`  OK   ${label} — would rotate`);
      } else {
        const { error: updateError } = await supabase
          .from('provider_api_keys')
          .update({ encrypted_key: encryptedKey, key_iv: iv })
          .eq('id', row.id);

        if (updateError) {
          console.error(`  FAIL ${label} — update error: ${updateError.message}`);
          failed++;
          continue;
        }
        console.log(`  OK   ${label} — rotated to v2`);
      }
      rotated++;
    } catch (err) {
      console.error(`  FAIL ${label} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Rotated: ${rotated}, Skipped: ${skipped}, Failed: ${failed}`);
  if (failed > 0) {
    console.error('\nWARNING: Some keys failed rotation. Do NOT swap env vars until resolved.');
    process.exit(1);
  }
  if (!dryRun && rotated > 0) {
    console.log('\nNext steps:');
    console.log('  1. Verify keys work in the app');
    console.log('  2. Swap: PROVIDER_KEY_ENCRYPTION_KEY = <v2 value>, remove _V2');
    console.log('  3. Deploy');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
