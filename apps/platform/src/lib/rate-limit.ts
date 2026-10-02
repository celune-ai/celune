/**
 * Simple in-memory rate limiter.
 *
 * Tracks timestamps of recent attempts per key in a Map.
 * Stale entries are cleaned up automatically on each check.
 * Suitable for single-instance Next.js deployments (no Redis needed).
 *
 * Usage:
 *   const limiter = createRateLimit({ limit: 5, windowMs: 15 * 60 * 1000 });
 *   const result = limiter.check(userId);
 *   if (!result.allowed) { return 429; }
 */

export interface RateLimitConfig {
  /** Maximum number of attempts allowed within the window. */
  limit: number;
  /** Window duration in milliseconds. */
  windowMs: number;
}

export interface RateLimitCheck {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the oldest tracked attempt expires (i.e. when a slot opens). */
  retryAfterMs: number;
}

export interface RateLimiter {
  /** Check (and record) an attempt for the given key. */
  check(key: string): RateLimitCheck;
  /** Reset all tracked state — useful for testing. */
  reset(): void;
}

/**
 * Create an in-memory rate limiter.
 *
 * Each call to `check(key)` records the current timestamp and returns
 * whether the caller is within the allowed limit. Old timestamps outside
 * the window are pruned on every check to prevent unbounded growth.
 */
export function createRateLimit(config: RateLimitConfig): RateLimiter {
  const { limit, windowMs } = config;

  // Map from key -> sorted array of attempt timestamps (ms)
  const attempts = new Map<string, number[]>();

  function prune(key: string, now: number): number[] {
    const timestamps = attempts.get(key);
    if (!timestamps) return [];
    const cutoff = now - windowMs;
    const valid = timestamps.filter((t) => t > cutoff);
    if (valid.length === 0) {
      attempts.delete(key);
      return [];
    }
    attempts.set(key, valid);
    return valid;
  }

  function check(key: string): RateLimitCheck {
    const now = Date.now();
    const current = prune(key, now);

    if (current.length >= limit) {
      // Blocked — calculate when the oldest attempt in the window expires
      const oldestInWindow = current[0];
      const retryAfterMs = oldestInWindow + windowMs - now;
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, retryAfterMs) };
    }

    // Record this attempt
    current.push(now);
    attempts.set(key, current);

    return {
      allowed: true,
      remaining: limit - current.length,
      retryAfterMs: 0,
    };
  }

  function reset(): void {
    attempts.clear();
  }

  return { check, reset };
}
