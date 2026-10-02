/**
 * apps/platform/src/lib/ward/dedup.ts
 *
 * Error deduplication and rate limiting for the WARD auto-fix pipeline.
 *
 * Two-layer dedup strategy:
 * 1. In-memory map for hot-path speed (best-effort on serverless)
 * 2. DB-level unique constraint on ward_fix_log for cross-instance durability
 *
 * Uses lazy cleanup instead of setInterval to avoid timer leaks on serverless
 * cold starts (Vercel functions don't guarantee timer execution).
 */

import { createServiceClient } from '@repo/db/service';
import type { WardConfig } from './config';

// ── Types ───────────────────────────────────────────────────────────────────

interface DedupEntry {
  firstSeen: number;
  count: number;
}

interface RateLimitEntry {
  hourlyCount: number;
  dailyCount: number;
  hourlyResetAt: number;
  dailyResetAt: number;
}

export interface ProcessDecision {
  allowed: boolean;
  reason?: string;
}

// ── In-memory stores (hot-path layer) ───────────────────────────────────────

/** Tracks seen error fingerprints per workspace. Key: `${workspaceId}::${fingerprint}` */
const seenErrors = new Map<string, DedupEntry>();

/** Tracks fix counts per workspace for rate limiting. Key: workspaceId */
const rateLimits = new Map<string, RateLimitEntry>();

// TTL for dedup entries: 1 hour (errors seen within this window are duplicates)
const DEDUP_TTL_MS = 60 * 60 * 1000;

// Lazy cleanup: purge expired entries every N calls instead of using setInterval
const CLEANUP_EVERY_N_CALLS = 10;
let callsSinceCleanup = 0;

// ── Lazy Cleanup ────────────────────────────────────────────────────────────

function lazyCleanup(): void {
  callsSinceCleanup++;
  if (callsSinceCleanup < CLEANUP_EVERY_N_CALLS) return;
  callsSinceCleanup = 0;

  const now = Date.now();

  for (const [key, entry] of seenErrors) {
    if (now - entry.firstSeen > DEDUP_TTL_MS) {
      seenErrors.delete(key);
    }
  }

  for (const [key, entry] of rateLimits) {
    if (now > entry.dailyResetAt) {
      rateLimits.delete(key);
    }
  }
}

// ── DB-level dedup (durable layer) ──────────────────────────────────────────

/**
 * Check the ward_fix_log table for a prior processing record.
 * Returns true if the error was already processed (should skip).
 *
 * On insert, uses ON CONFLICT to atomically prevent duplicates.
 * If the insert succeeds, this instance wins the race. If it conflicts,
 * another instance already claimed it.
 */
async function checkAndClaimInDb(
  workspaceId: string,
  fingerprint: string,
): Promise<{ alreadyClaimed: boolean }> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from('ward_fix_log').insert({
      workspace_id: workspaceId,
      fingerprint,
    });

    if (error) {
      // Unique constraint violation = already claimed by another instance
      if (error.code === '23505') {
        return { alreadyClaimed: true };
      }
      // Other DB errors — fall through to in-memory only (best-effort)
      console.warn(`[ward-dedup] DB claim failed: ${error.message}`);
    }

    return { alreadyClaimed: false };
  } catch {
    // DB unavailable — rely on in-memory dedup only
    return { alreadyClaimed: false };
  }
}

// ── Core logic ──────────────────────────────────────────────────────────────

/**
 * Check if an error should be processed by the WARD pipeline.
 *
 * Applies two-layer deduplication (in-memory + DB) and
 * rate limiting (max fixes per hour/day per workspace).
 */
export async function shouldProcess(
  workspaceId: string,
  errorFingerprint: string,
  config: Pick<WardConfig, 'maxFixesPerHour' | 'maxFixesPerDay'>,
): Promise<ProcessDecision> {
  const now = Date.now();

  // Lazy cleanup of expired in-memory entries
  lazyCleanup();

  // ── In-memory dedup check (fast path) ─────────────────────────────────

  const dedupKey = `${workspaceId}::${errorFingerprint}`;
  const existing = seenErrors.get(dedupKey);

  if (existing && now - existing.firstSeen < DEDUP_TTL_MS) {
    existing.count++;
    return {
      allowed: false,
      reason: `Duplicate error (seen ${existing.count} times in dedup window)`,
    };
  }

  // ── DB-level dedup check (durable, cross-instance) ────────────────────

  const { alreadyClaimed } = await checkAndClaimInDb(workspaceId, errorFingerprint);
  if (alreadyClaimed) {
    // Update in-memory too so subsequent calls within this instance are fast
    seenErrors.set(dedupKey, { firstSeen: now, count: 1 });
    return {
      allowed: false,
      reason: 'Duplicate error (already processed by another instance)',
    };
  }

  // Mark as seen in memory
  seenErrors.set(dedupKey, { firstSeen: now, count: 1 });

  // ── Rate limit check ───────────────────────────────────────────────────

  let limits = rateLimits.get(workspaceId);

  if (!limits) {
    limits = {
      hourlyCount: 0,
      dailyCount: 0,
      hourlyResetAt: now + 60 * 60 * 1000,
      dailyResetAt: now + 24 * 60 * 60 * 1000,
    };
    rateLimits.set(workspaceId, limits);
  }

  // Reset counters if windows have expired
  if (now >= limits.hourlyResetAt) {
    limits.hourlyCount = 0;
    limits.hourlyResetAt = now + 60 * 60 * 1000;
  }
  if (now >= limits.dailyResetAt) {
    limits.dailyCount = 0;
    limits.dailyResetAt = now + 24 * 60 * 60 * 1000;
  }

  if (limits.hourlyCount >= config.maxFixesPerHour) {
    return {
      allowed: false,
      reason: `Hourly rate limit reached (${limits.hourlyCount}/${config.maxFixesPerHour})`,
    };
  }

  if (limits.dailyCount >= config.maxFixesPerDay) {
    return {
      allowed: false,
      reason: `Daily rate limit reached (${limits.dailyCount}/${config.maxFixesPerDay})`,
    };
  }

  // Increment counters
  limits.hourlyCount++;
  limits.dailyCount++;

  return { allowed: true };
}

/**
 * Reset all dedup and rate limit state.
 * Useful for testing.
 */
export function resetState(): void {
  seenErrors.clear();
  rateLimits.clear();
  callsSinceCleanup = 0;
}
