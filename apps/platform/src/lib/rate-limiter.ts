import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

// ─── In-memory fallback (per-instance, used when Supabase is unavailable) ────

const inMemoryStore = new Map<string, { count: number; windowStart: number }>();

function checkRateLimitInMemory(
  identifier: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const entry = inMemoryStore.get(identifier);

  if (!entry || now - entry.windowStart >= windowMs) {
    // Window expired or first request — reset
    inMemoryStore.set(identifier, { count: 1, windowStart: now });
    return {
      allowed: true,
      remaining: limit - 1,
      resetAt: new Date(now + windowMs),
    };
  }

  entry.count += 1;
  const resetAt = new Date(entry.windowStart + windowMs);

  if (entry.count > limit) {
    return { allowed: false, remaining: 0, resetAt };
  }

  return {
    allowed: true,
    remaining: limit - entry.count,
    resetAt,
  };
}

// Periodic cleanup of expired in-memory entries (every 60s)
let lastCleanup = Date.now();
function cleanupInMemoryStore(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [key, entry] of inMemoryStore) {
    if (now - entry.windowStart >= windowMs) {
      inMemoryStore.delete(key);
    }
  }
}

// ─── Supabase-backed rate limiting (atomic upsert) ───────────────────────────

const SUPABASE_TIMEOUT_MS = 500;

async function checkRateLimitSupabase(
  identifier: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult | null> {
  try {
    const supabase = createServiceClient();

    // Atomic upsert: insert or update in a single query.
    // If the window has expired, reset count to 1 and window_start to now().
    // Otherwise, increment the count.
    const { data, error } = await Promise.race([
      supabase.rpc('rate_limit_check', {
        p_key: identifier,
        p_window_ms: windowMs,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Rate limit DB timeout')), SUPABASE_TIMEOUT_MS),
      ),
    ]);

    if (error) {
      console.error('[RateLimit] Supabase error, falling back to in-memory:', error.message);
      return null;
    }

    // rpc returns an array with one row
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      console.error('[RateLimit] No data returned from rate_limit_check');
      return null;
    }

    const count = row.out_count as number;
    const windowStart = new Date(row.out_window_start as string);
    const resetAt = new Date(windowStart.getTime() + windowMs);

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[RateLimit] Supabase unavailable, falling back to in-memory:', message);
    return null;
  }
}

/**
 * Check rate limit for a given identifier and window.
 *
 * Tries Supabase first (shared state across instances), falls back to
 * in-memory if the DB call fails or times out (500ms).
 *
 * @param identifier - composite key, e.g. `${userId}:${routeKey}`
 * @param limit - max requests allowed in the window
 * @param windowMs - window duration in milliseconds
 */
export async function checkRateLimit(
  identifier: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  // Try Supabase first for cross-instance consistency
  const supabaseResult = await checkRateLimitSupabase(identifier, limit, windowMs);
  if (supabaseResult) return supabaseResult;

  // Fallback: per-instance in-memory rate limiting
  cleanupInMemoryStore(windowMs);
  return checkRateLimitInMemory(identifier, limit, windowMs);
}

// ─── Rate limit tiers ───────────────────────────────────────────────────────

/** 20 req/min — AI chat, TTS (cost-sensitive) */
export const RATE_AI = { limit: 20, windowMs: 60_000 } as const;

/** 5 req/min — auth routes (brute force protection) */
export const RATE_AUTH = { limit: 5, windowMs: 60_000 } as const;

/** 60 req/min — write operations (POST/PATCH/DELETE) */
export const RATE_WRITE = { limit: 60, windowMs: 60_000 } as const;

/** 120 req/min — read operations (GET) */
export const RATE_READ = { limit: 120, windowMs: 60_000 } as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIP = request.headers.get('x-real-ip');
  if (realIP) return realIP;
  return 'unknown';
}

/**
 * Apply rate limiting to an API route.
 *
 * Returns a 429 NextResponse with Retry-After header if limited,
 * or null if the request is allowed. Also returns rate limit headers
 * to add to the successful response.
 *
 * @param request - incoming NextRequest
 * @param routeKey - unique key for this route, e.g. "agents.chat"
 * @param tier - rate limit tier config ({ limit, windowMs })
 * @param useUserId - if true, use authenticated userId; otherwise use IP
 */
export async function applyRateLimit(
  request: NextRequest,
  routeKey: string,
  tier: { limit: number; windowMs: number },
  useUserId = true,
): Promise<{ blocked: NextResponse; headers: Record<string, string> } | null> {
  const base = useUserId ? (getAuthUserId(request) ?? getClientIP(request)) : getClientIP(request);
  const identifier = `${base}:${routeKey}`;

  const result = await checkRateLimit(identifier, tier.limit, tier.windowMs);

  const retryAfterSecs = Math.ceil((result.resetAt.getTime() - Date.now()) / 1000);
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(tier.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.floor(result.resetAt.getTime() / 1000)),
  };

  if (!result.allowed) {
    return {
      blocked: NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: {
            ...headers,
            'Retry-After': String(retryAfterSecs),
            'Content-Type': 'application/json',
          },
        },
      ),
      headers,
    };
  }

  return null;
}
