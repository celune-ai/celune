#!/usr/bin/env node
/**
 * sync-org-github-installations.mjs
 *
 * Fetches GitHub account metadata (login, avatar_url, type) for all
 * org_github_installations records that have placeholder values.
 *
 * Usage: node packages/db/scripts/sync-org-github-installations.mjs
 *
 * Requires: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY env vars
 *           (or inherited from apps/platform/.env.local)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env from admin app
function loadEnv() {
  const envPath = resolve(__dirname, '../../../apps/platform/.env.local');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    let value = trimmed.slice(eqIdx + 1);
    // Strip quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appId = process.env.GITHUB_APP_ID;
const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!appId || !privateKey) {
  console.error('Missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const appOctokit = new Octokit({
  authStrategy: createAppAuth,
  auth: { appId: Number(appId), privateKey },
});

async function main() {
  // Fetch installations needing sync
  const { data: installations, error } = await supabase
    .from('org_github_installations')
    .select('*')
    .eq('github_account_login', 'pending-sync');

  if (error) {
    console.error('Failed to fetch installations:', error.message);
    process.exit(1);
  }

  if (!installations?.length) {
    console.log('No installations need syncing.');
    return;
  }

  console.log(`Found ${installations.length} installation(s) to sync.`);

  for (const inst of installations) {
    try {
      const { data: ghInstall } = await appOctokit.rest.apps.getInstallation({
        installation_id: inst.installation_id,
      });

      const account = ghInstall.account;
      if (!account) {
        console.warn(`  [${inst.installation_id}] No account data from GitHub — skipping`);
        continue;
      }

      const { error: updateError } = await supabase
        .from('org_github_installations')
        .update({
          github_account_login: account.login,
          github_account_avatar_url: account.avatar_url ?? null,
          github_account_type: account.type === 'Organization' ? 'Organization' : 'User',
        })
        .eq('id', inst.id);

      if (updateError) {
        console.error(`  [${inst.installation_id}] Update failed:`, updateError.message);
      } else {
        console.log(`  [${inst.installation_id}] → ${account.login} (${account.type})`);
      }
    } catch (err) {
      console.error(`  [${inst.installation_id}] GitHub API error:`, err.message);
    }
  }

  console.log('Done.');
}

main().catch(console.error);
