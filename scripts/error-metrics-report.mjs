#!/usr/bin/env node

/**
 * Error Metrics Report — Queries completed tasks for error reduction metrics.
 *
 * Usage:
 *   node scripts/error-metrics-report.mjs [--days <n>]
 *
 * Options:
 *   --days <n>   Only include tasks completed in the last N days (default: all)
 *
 * Uses native fetch against Supabase REST API (no npm dependencies).
 * Reads credentials from apps/platform/.env.local (same as task-cli.mjs).
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Load env
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Supabase REST query via native fetch
// ---------------------------------------------------------------------------

async function queryTasks(days) {
  const params = new URLSearchParams({
    select: 'id,title,status,metadata,completed_at,assignee',
    status: 'eq.done',
    order: 'completed_at.desc',
  });

  if (days) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    params.append('completed_at', `gte.${since.toISOString()}`);
  }

  const url = `${supabaseUrl}/rest/v1/tasks?${params}`;
  const res = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase query failed (${res.status}): ${body}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) {
      flags.days = parseInt(args[i + 1], 10);
      i++;
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const flags = parseArgs(process.argv);
  const tasks = await queryTasks(flags.days);

  // Filter to tasks that have metrics in metadata
  const withMetrics = tasks.filter(
    (t) => t.metadata && typeof t.metadata === 'object' && t.metadata.metrics,
  );

  const allTasks = tasks.length;
  const metricsCount = withMetrics.length;

  console.log('═══════════════════════════════════════════════');
  console.log('  ERROR REDUCTION METRICS REPORT');
  console.log('═══════════════════════════════════════════════');
  console.log();
  console.log(`  Period:          ${flags.days ? `Last ${flags.days} days` : 'All time'}`);
  console.log(`  Completed tasks: ${allTasks}`);
  console.log(`  With metrics:    ${metricsCount}`);
  console.log();

  if (metricsCount === 0) {
    console.log('  No tasks with metrics data found.');
    console.log('  Agents should record metrics in task metadata when completing tasks.');
    console.log('  See: packages/brain/core/agent_docs/error-metrics.md');
    console.log();
    console.log('═══════════════════════════════════════════════');
    return;
  }

  // Calculate aggregates
  const sums = { test_failures: 0, rework_count: 0, qa_bugs: 0, review_rejections: 0 };
  const counts = { test_failures: 0, rework_count: 0, qa_bugs: 0, review_rejections: 0 };

  for (const task of withMetrics) {
    const m = task.metadata.metrics;
    for (const key of Object.keys(sums)) {
      if (typeof m[key] === 'number') {
        sums[key] += m[key];
        counts[key]++;
      }
    }
  }

  const avg = (key) => (counts[key] > 0 ? (sums[key] / counts[key]).toFixed(2) : 'N/A');
  const total = (key) => (counts[key] > 0 ? sums[key] : 'N/A');

  console.log('  Metric               Total    Avg/Task   Reported');
  console.log('  ───────────────────── ──────── ────────── ────────');
  console.log(
    `  Test Failures         ${String(total('test_failures')).padStart(8)} ${String(avg('test_failures')).padStart(10)} ${String(counts.test_failures).padStart(8)}`,
  );
  console.log(
    `  Rework Count          ${String(total('rework_count')).padStart(8)} ${String(avg('rework_count')).padStart(10)} ${String(counts.rework_count).padStart(8)}`,
  );
  console.log(
    `  QA Bugs               ${String(total('qa_bugs')).padStart(8)} ${String(avg('qa_bugs')).padStart(10)} ${String(counts.qa_bugs).padStart(8)}`,
  );
  console.log(
    `  Review Rejections     ${String(total('review_rejections')).padStart(8)} ${String(avg('review_rejections')).padStart(10)} ${String(counts.review_rejections).padStart(8)}`,
  );
  console.log();

  // Error rate: total errors per task
  const totalErrors = sums.test_failures + sums.qa_bugs + sums.review_rejections;
  const errorRate = metricsCount > 0 ? (totalErrors / metricsCount).toFixed(2) : 'N/A';
  console.log(`  Combined error rate:  ${errorRate} errors/task`);
  console.log();

  // Per-agent breakdown
  const byAgent = {};
  for (const task of withMetrics) {
    const agent = task.assignee || 'unknown';
    if (!byAgent[agent]) byAgent[agent] = { tasks: 0, errors: 0 };
    byAgent[agent].tasks++;
    const m = task.metadata.metrics;
    byAgent[agent].errors += (m.test_failures || 0) + (m.qa_bugs || 0) + (m.review_rejections || 0);
  }

  if (Object.keys(byAgent).length > 0) {
    console.log('  Per-Agent Breakdown:');
    console.log('  Agent                Tasks  Errors  Rate');
    console.log('  ───────────────────── ────── ─────── ──────');
    for (const [agent, data] of Object.entries(byAgent).sort((a, b) => b[1].tasks - a[1].tasks)) {
      const rate = data.tasks > 0 ? (data.errors / data.tasks).toFixed(2) : 'N/A';
      console.log(
        `  ${agent.padEnd(23)} ${String(data.tasks).padStart(6)} ${String(data.errors).padStart(7)} ${String(rate).padStart(6)}`,
      );
    }
    console.log();
  }

  console.log('═══════════════════════════════════════════════');
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
