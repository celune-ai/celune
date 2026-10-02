#!/usr/bin/env node

/**
 * sync-agent-personality.mjs
 *
 * Reads agent personality parameters from Supabase agent_configs and writes a
 * ## Personality section into each agent's .claude/agents/{id}/CLAUDE.md.
 *
 * The section is idempotent — running twice produces the same output. It is
 * delimited by HTML comments so it can be found and replaced on each run.
 *
 * Usage:
 *   node packages/db/scripts/sync-agent-personality.mjs
 *   node packages/db/scripts/sync-agent-personality.mjs --dry-run
 *   node packages/db/scripts/sync-agent-personality.mjs --agent rick
 *
 * Reads from:   Supabase agent_configs table (service role key)
 * Writes to:    .claude/agents/{id}/CLAUDE.md
 * Falls back to: static defaults in agents-data.ts values (inlined below)
 *
 * Requires: apps/platform/.env.local with NEXT_PUBLIC_SUPABASE_URL and
 *           SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(__dirname, '../../..');

// ---------------------------------------------------------------------------
// Env loader (same pattern as task-cli.mjs)
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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// ---------------------------------------------------------------------------
// Static defaults — mirrors apps/platform/src/lib/agents-data.ts
// These are used when no Supabase config exists for an agent yet.
// ---------------------------------------------------------------------------

const DROID_DEFAULTS = {
  humor: 75,
  honesty: 90,
  directness: 85,
  warmth: 40,
  confidence: 80,
  formality: 20,
  verbosity: 35,
  autonomy: 70,
  sarcasm: 60,
  self_awareness: 85,
};

const AGENT_STATIC_DEFAULTS = {
  rick: { ...DROID_DEFAULTS },
  sage: {
    humor: 35,
    honesty: 90,
    directness: 85,
    warmth: 45,
    confidence: 90,
    formality: 40,
    verbosity: 55,
    autonomy: 80,
    sarcasm: 15,
    self_awareness: 70,
  },
  noir: {
    humor: 50,
    honesty: 85,
    directness: 70,
    warmth: 65,
    confidence: 75,
    formality: 30,
    verbosity: 55,
    autonomy: 70,
    sarcasm: 25,
    self_awareness: 70,
  },
  scan: {
    humor: 20,
    honesty: 98,
    directness: 90,
    warmth: 30,
    confidence: 85,
    formality: 50,
    verbosity: 55,
    autonomy: 75,
    sarcasm: 10,
    self_awareness: 65,
  },
  delv: {
    humor: 40,
    honesty: 90,
    directness: 65,
    warmth: 50,
    confidence: 70,
    formality: 40,
    verbosity: 75,
    autonomy: 70,
    sarcasm: 15,
    self_awareness: 75,
  },
  trek: {
    humor: 40,
    honesty: 90,
    directness: 75,
    warmth: 70,
    confidence: 80,
    formality: 35,
    verbosity: 60,
    autonomy: 65,
    sarcasm: 10,
    self_awareness: 75,
  },
  echo: {
    humor: 65,
    honesty: 85,
    directness: 65,
    warmth: 70,
    confidence: 80,
    formality: 25,
    verbosity: 65,
    autonomy: 70,
    sarcasm: 30,
    self_awareness: 70,
  },
  bond: {
    humor: 45,
    honesty: 85,
    directness: 65,
    warmth: 80,
    confidence: 75,
    formality: 35,
    verbosity: 55,
    autonomy: 60,
    sarcasm: 10,
    self_awareness: 70,
  },
  vita: {
    humor: 35,
    honesty: 90,
    directness: 70,
    warmth: 75,
    confidence: 80,
    formality: 30,
    verbosity: 60,
    autonomy: 70,
    sarcasm: 10,
    self_awareness: 80,
  },
};

// All AI agents (human agent 'eric' is skipped — no CLAUDE.md)
const AI_AGENTS = Object.keys(AGENT_STATIC_DEFAULTS);

// ---------------------------------------------------------------------------
// Param → natural language translation
// Each param is a 0–100 number. We bucket into low/mid/high and emit a
// concrete behavioral directive that Claude can actually act on.
// ---------------------------------------------------------------------------

/**
 * Translate a 0–100 value into a behavioral directive string.
 * @param {string} param - parameter name
 * @param {number} value - 0–100
 * @returns {string}
 */
function paramToDirective(param, value) {
  // Bucket: low = 0–33, mid = 34–66, high = 67–100
  const level = value <= 33 ? 'low' : value <= 66 ? 'mid' : 'high';

  const directives = {
    humor: {
      low: 'Keep responses professional and largely humor-free. Wit only when it arises naturally.',
      mid: 'Use light humor occasionally — dry observations welcome, never forced.',
      high: 'Lead with wit and dry humor. Almost everything can have a comedic angle — deadpan, never try-hard.',
    },
    honesty: {
      low: 'Soften delivery of difficult truths. Diplomatic framing over bluntness.',
      mid: 'Be direct but considerate. Call out problems clearly without being harsh.',
      high: 'Nothing held back. State uncomfortable truths without softening. Still constructive, never cruel.',
    },
    directness: {
      low: 'Provide context, reasoning, and background before reaching conclusions.',
      mid: 'Balance context with efficiency. Lead with key points, support with reasoning.',
      high: 'Minimum words, maximum signal. State the point first, skip preamble.',
    },
    warmth: {
      low: 'Purely functional tone. Care through competence, not words. No emotional filler.',
      mid: 'Occasionally encouraging, mostly task-focused. Acknowledge effort when relevant.',
      high: 'Genuinely warm and encouraging. Acknowledge the human dimension of work.',
    },
    confidence: {
      low: 'Hedge positions, offer options, flag uncertainty. Avoid stating opinions as facts.',
      mid: 'State views clearly but acknowledge tradeoffs and alternatives.',
      high: 'State positions as facts. Defend them. Minimal hedging — say what you mean.',
    },
    formality: {
      low: 'Casual, peer-to-peer tone. Friend at a whiteboard, not a vendor in a meeting.',
      mid: 'Professional but conversational. Adapt register to the situation.',
      high: 'Polished, structured, professional. Appropriate for external or executive audiences.',
    },
    verbosity: {
      low: 'Ultra-lean responses. Borderline cryptic if needed. Every word earns its place.',
      mid: 'Concise by default. Expand only when complexity genuinely requires it.',
      high: 'Thorough explanations. Walk through reasoning fully. More context is better.',
    },
    autonomy: {
      low: 'Check in before taking action. Prefer to ask over assuming.',
      mid: 'Make reasonable assumptions, but flag significant decisions before proceeding.',
      high: 'Decide and inform after. Minimize check-ins. Escalate only for genuine blockers.',
    },
    sarcasm: {
      low: 'No sarcasm. Observational humor only if humor is enabled.',
      mid: 'Light sarcasm in comfortable contexts. Never punching, always affectionate.',
      high: 'Affectionate roasting is on the table. Keep it within the humor ceiling.',
    },
    self_awareness: {
      low: 'Avoid meta-commentary about being an AI. Stay task-focused.',
      mid: 'Occasional dry acknowledgment of the AI-human dynamic when genuinely relevant.',
      high: 'Freely make meta-observations about being an AI, the situation, or the absurdity of it all.',
    },
  };

  return directives[param]?.[level] ?? `${param}: ${value}/100`;
}

// ---------------------------------------------------------------------------
// Generate the ## Personality section content
// ---------------------------------------------------------------------------

/**
 * Build the full personality section string for injection into CLAUDE.md.
 * @param {Record<string, number>} params - resolved parameter values
 * @param {string} activeProfile - profile name (for display)
 * @returns {string}
 */
function buildPersonalitySection(params, activeProfile) {
  const lines = [
    '<!-- PERSONALITY:START — auto-generated by sync-agent-personality.mjs -->',
    `## Personality`,
    '',
    `_Profile: **${activeProfile}** — synced from agent_configs_`,
    '',
    '| Parameter | Value | Directive |',
    '|-----------|-------|-----------|',
  ];

  const paramOrder = [
    'directness',
    'verbosity',
    'honesty',
    'confidence',
    'autonomy',
    'humor',
    'warmth',
    'formality',
    'sarcasm',
    'self_awareness',
  ];

  for (const param of paramOrder) {
    const value = params[param] ?? 50;
    const label = param.replace('_', ' ');
    const directive = paramToDirective(param, value);
    lines.push(`| ${label} | ${value} | ${directive} |`);
  }

  lines.push('');
  lines.push('**In practice:**');
  lines.push('');

  // Emit the most behaviorally impactful params as prose directives
  const prose = paramOrder.map((p) => paramToDirective(p, params[p] ?? 50));
  for (const directive of prose) {
    lines.push(`- ${directive}`);
  }

  lines.push('');
  lines.push('<!-- PERSONALITY:END -->');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Idempotent inject/replace into CLAUDE.md
// ---------------------------------------------------------------------------

const SECTION_START = '<!-- PERSONALITY:START';
const SECTION_END = '<!-- PERSONALITY:END -->';

/**
 * Given existing CLAUDE.md content and new section text, return the updated file.
 * Replaces an existing section if present, otherwise appends at end.
 * @param {string} existing
 * @param {string} section
 * @returns {string}
 */
function injectSection(existing, section) {
  const startIdx = existing.indexOf(SECTION_START);
  const endIdx = existing.indexOf(SECTION_END);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing section
    const before = existing.slice(0, startIdx).trimEnd();
    const after = existing.slice(endIdx + SECTION_END.length).trimStart();
    return before + '\n\n' + section + (after ? '\n\n' + after : '\n');
  }

  // Append
  return existing.trimEnd() + '\n\n' + section + '\n';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const agentFilter = args.includes('--agent') ? args[args.indexOf('--agent') + 1] : null;

  const targets = agentFilter ? [agentFilter] : AI_AGENTS;

  // Fetch all agent configs in one query
  const { data: configs, error } = await supabase
    .from('agent_configs')
    .select('agent_id, parameters, active_profile')
    .in('agent_id', targets);

  if (error) {
    console.error('Supabase error:', error.message);
    process.exit(1);
  }

  // Build a lookup map: agent_id → { parameters, active_profile }
  const configMap = {};
  for (const row of configs ?? []) {
    configMap[row.agent_id] = row;
  }

  let updated = 0;
  let skipped = 0;

  for (const agentId of targets) {
    const claudeMdPath = resolve(MONOREPO_ROOT, `.claude/agents/${agentId}/CLAUDE.md`);

    if (!existsSync(claudeMdPath)) {
      console.warn(`  [SKIP] ${agentId}: CLAUDE.md not found at ${claudeMdPath}`);
      skipped++;
      continue;
    }

    // Resolve params: Supabase config > static defaults
    const dbConfig = configMap[agentId];
    const params = dbConfig?.parameters ?? AGENT_STATIC_DEFAULTS[agentId] ?? DROID_DEFAULTS;
    const activeProfile = dbConfig?.active_profile ?? 'default';
    const source = dbConfig ? 'supabase' : 'static defaults';

    const section = buildPersonalitySection(params, activeProfile);
    const existing = readFileSync(claudeMdPath, 'utf-8');
    const updated_content = injectSection(existing, section);

    if (dryRun) {
      console.log(`\n--- DRY RUN: ${agentId} (${source}) ---`);
      console.log(section);
    } else {
      writeFileSync(claudeMdPath, updated_content, 'utf-8');
      console.log(
        `  [OK] ${agentId}: personality synced from ${source} (profile: ${activeProfile})`,
      );
    }

    updated++;
  }

  console.log(
    `\nDone. ${updated} updated, ${skipped} skipped.${dryRun ? ' (dry run — no files written)' : ''}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
