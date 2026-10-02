#!/usr/bin/env node

/**
 * Seed default voice assignments for all 9 AI agents.
 * Idempotent — only sets voice_settings if currently empty/null/{}.
 *
 * Usage: node packages/db/scripts/seed-agent-voices.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../../../apps/platform/.env.local');
const env = {};
readFileSync(envPath, 'utf8')
  .split('\n')
  .forEach((line) => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) env[key.trim()] = rest.join('=').trim();
  });

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const VOICE_ASSIGNMENTS = [
  {
    agent_id: 'rick',
    voice_name: 'Adam',
    voice_id: 'pNInz6obpgDQGcFmaJgB',
    note: 'Dominant, firm — deep, confident, authoritative',
  },
  {
    agent_id: 'sage',
    voice_name: 'Sarah',
    voice_id: 'EXAVITQu4vr4xnSDxMaL',
    note: 'Mature, reassuring, confident — warm, articulate',
  },
  {
    agent_id: 'noir',
    voice_name: 'Charlie',
    voice_id: 'IKne3meq5aSn9XLyUdCD',
    note: 'Deep, confident, energetic — smooth, artistic',
  },
  {
    agent_id: 'scan',
    voice_name: 'Daniel',
    voice_id: 'onwK4e9ZLuTAKqWW03F9',
    note: 'Steady broadcaster — clear, measured',
  },
  {
    agent_id: 'delv',
    voice_name: 'River',
    voice_id: 'SAz9YHcvj6GT2YYXdXww',
    note: 'Relaxed, neutral, informative — neutral, questioning',
  },
  {
    agent_id: 'trek',
    voice_name: 'Chris',
    voice_id: 'iP95p4xoKVk53GoZ742B',
    note: 'Charming, down-to-earth — warm, motivating',
  },
  {
    agent_id: 'echo',
    voice_name: 'Matilda',
    voice_id: 'XrExE9yKIg1WjnnlVkGX',
    note: 'Knowledgable, professional — professional, balanced',
  },
  {
    agent_id: 'bond',
    voice_name: 'Bella',
    voice_id: 'hpp4J3VqNfWAUOO0d1Us',
    note: 'Professional, bright, warm — gentle, trustworthy',
  },
  {
    agent_id: 'vita',
    voice_name: 'Jessica',
    voice_id: 'cgSgspJ2msm6clMCkdW9',
    note: 'Playful, bright, warm — upbeat, dynamic',
  },
];

const DEFAULT_PARAMS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.0,
};

async function seed() {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  for (const assignment of VOICE_ASSIGNMENTS) {
    // Check existing config
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_configs?agent_id=eq.${assignment.agent_id}&select=voice_settings`,
      { headers: { ...headers, Prefer: '' } },
    );
    const rows = await checkRes.json();

    const existing = rows[0]?.voice_settings;
    if (existing && typeof existing === 'object' && existing.voice_id) {
      console.log(`  SKIP ${assignment.agent_id} — already has voice: ${existing.voice_name}`);
      continue;
    }

    const voiceSettings = {
      provider: 'elevenlabs',
      voice_id: assignment.voice_id,
      voice_name: assignment.voice_name,
      params: DEFAULT_PARAMS,
    };

    // Upsert
    const res = await fetch(`${SUPABASE_URL}/rest/v1/agent_configs`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        agent_id: assignment.agent_id,
        voice_settings: voiceSettings,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`  FAIL ${assignment.agent_id}: ${err}`);
    } else {
      console.log(`  SET  ${assignment.agent_id} → ${assignment.voice_name} (${assignment.note})`);
    }
  }

  console.log('\nDone seeding voice assignments.');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
