#!/usr/bin/env node

/**
 * Backfill changelog_entries from merged PRs using the GitHub CLI.
 *
 * Usage:
 *   node packages/db/scripts/backfill-changelog.mjs [--repo owner/name] [--workspace-id uuid] [--dry-run]
 *
 * Requires:
 *   - gh CLI authenticated
 *   - NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/platform/.env.local
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Parse args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const repoIdx = args.indexOf('--repo');
const repo = repoIdx !== -1 ? args[repoIdx + 1] : 'celune-ai/celune';
const wsIdx = args.indexOf('--workspace-id');

// ── Load env ────────────────────────────────────────────────────────────────

const envPath = resolve(import.meta.dirname, '../../../apps/platform/.env.local');
let SUPABASE_URL = '';
let SUPABASE_KEY = '';

try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) SUPABASE_URL = line.split('=')[1].trim();
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) SUPABASE_KEY = line.split('=')[1].trim();
  }
} catch {
  console.error('Failed to read .env.local');
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Resolve workspace ID
let workspaceId = wsIdx !== -1 ? args[wsIdx + 1] : null;

if (!workspaceId) {
  // Auto-detect from first workspace connected to this repo
  const wsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspaces?repo_url=eq.https://github.com/${repo}&select=id&limit=1`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    },
  );
  const workspaces = await wsRes.json();
  if (workspaces.length > 0) {
    workspaceId = workspaces[0].id;
    console.log(`Auto-detected workspace: ${workspaceId}`);
  } else {
    console.error('No workspace found for repo. Use --workspace-id.');
    process.exit(1);
  }
}

// ── Fetch merged PRs ────────────────────────────────────────────────────────

console.log(`Fetching merged PRs from ${repo}...`);

const prJson = execSync(
  `gh pr list --repo ${repo} --state merged --limit 500 --json number,title,body,mergedAt,labels,additions,deletions,author,url`,
  { maxBuffer: 10 * 1024 * 1024 },
).toString();

const prs = JSON.parse(prJson);
console.log(`Found ${prs.length} merged PRs`);

// ── Check existing entries ──────────────────────────────────────────────────

const existingRes = await fetch(
  `${SUPABASE_URL}/rest/v1/changelog_entries?workspace_id=eq.${workspaceId}&select=pr_number`,
  {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  },
);
const existing = await existingRes.json();
const existingPrNumbers = new Set(existing.map((e) => e.pr_number));
console.log(`${existingPrNumbers.size} entries already exist`);

// ── Categorize PR ───────────────────────────────────────────────────────────

function categorize(title, labels) {
  const labelNames = (labels || []).map((l) => l.name.toLowerCase());

  if (labelNames.includes('fix') || labelNames.includes('bug')) return 'Fix';
  if (labelNames.includes('breaking')) return 'Breaking Change';
  if (labelNames.includes('improvement') || labelNames.includes('enhancement'))
    return 'Improvement';
  if (labelNames.includes('security')) return 'Security';

  if (title.startsWith('fix:') || title.startsWith('fix(')) return 'Fix';
  if (title.startsWith('security:') || title.startsWith('security(')) return 'Security';
  if (title.startsWith('refactor:') || title.startsWith('chore:')) return 'System';
  if (title.startsWith('docs:')) return 'Documentation';
  if (title.startsWith('test:')) return 'System';
  if (title.startsWith('perf:')) return 'Improvement';

  return 'Feature';
}

function cleanTitle(title) {
  return title.replace(/^(feat|fix|refactor|chore|docs|test|perf|security)(\(.+?\))?:\s*/i, '');
}

function extractDescription(body, title) {
  if (!body) return title;
  const summaryMatch = body.match(/^## Summary\n([\s\S]*?)(?=\n##|\n$)/);
  if (summaryMatch) {
    return summaryMatch[1]
      .replace(/^[-*]\s*/gm, '')
      .trim()
      .slice(0, 300);
  }
  // Fallback: first paragraph
  const firstParagraph = body.split('\n\n')[0]?.trim();
  if (firstParagraph && firstParagraph.length > 10) {
    return firstParagraph.slice(0, 300);
  }
  return title;
}

// ── Generate entries ────────────────────────────────────────────────────────

const entries = [];
let skipped = 0;

for (const pr of prs) {
  if (existingPrNumbers.has(pr.number)) {
    skipped++;
    continue;
  }

  const date = new Date(pr.mergedAt).toISOString().slice(0, 10);
  const slug = `${date}-pr-${pr.number}`;

  entries.push({
    slug,
    date,
    title: cleanTitle(pr.title),
    description: extractDescription(pr.body, pr.title),
    category: categorize(pr.title, pr.labels),
    body: pr.body || null,
    pr_number: pr.number,
    pr_url: pr.url,
    repo,
    auto_generated: true,
    workspace_id: workspaceId,
  });
}

console.log(`${entries.length} new entries to create (${skipped} already exist)`);

if (dryRun) {
  console.log('\n[DRY RUN] First 5 entries:');
  for (const e of entries.slice(0, 5)) {
    console.log(`  #${e.pr_number}: [${e.category}] ${e.title}`);
  }
  process.exit(0);
}

// ── Insert in batches ───────────────────────────────────────────────────────

const BATCH_SIZE = 50;
let inserted = 0;

for (let i = 0; i < entries.length; i += BATCH_SIZE) {
  const batch = entries.slice(i, i + BATCH_SIZE);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/changelog_entries`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(batch),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Batch ${i / BATCH_SIZE + 1} failed:`, err);
    continue;
  }

  inserted += batch.length;
  console.log(`Inserted batch ${i / BATCH_SIZE + 1} (${inserted}/${entries.length})`);
}

console.log(`\nDone! ${inserted} changelog entries created.`);
