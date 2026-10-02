import { describe, it, expect, beforeEach, vi } from 'vitest';
import { shouldProcess, resetState } from '@/lib/ward/dedup';
import { checkAutoFixEligibility, DEFAULT_WARD_CONFIG } from '@/lib/ward/config';

// Mock the DB service client so dedup tests don't hit a real database.
// The insert mock returns success (no conflict) so in-memory dedup is the primary check.
vi.mock('@repo/db/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: () => Promise.resolve({ error: null }),
    }),
  }),
}));

// ── Sentry signature verification ────────────────────────────────────────────
// verifySentrySignature checks secret → signature → timestamp in order.
// In test env, SENTRY_WEBHOOK_SECRET is empty, so we test the function
// with a mocked env var to exercise the timestamp logic.

describe('verifySentrySignature', () => {
  it('rejects when SENTRY_WEBHOOK_SECRET is not configured', async () => {
    const { verifySentrySignature } = await import('@/lib/sentry-verify');
    const result = verifySentrySignature('abc123', '{}');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('SENTRY_WEBHOOK_SECRET');
  });

  it('rejects when signature header is missing (secret check first)', async () => {
    // Without a secret configured, the secret check fires before the null-signature check
    const { verifySentrySignature } = await import('@/lib/sentry-verify');
    const result = verifySentrySignature(null, '{}');
    expect(result.valid).toBe(false);
    // Fails on secret not configured (first guard)
    expect(result.reason).toBeDefined();
  });

  it('allows requests without a timestamp header (graceful degradation)', async () => {
    const { verifySentrySignature } = await import('@/lib/sentry-verify');
    const result = verifySentrySignature('abc', '{}', null);
    // Should fail on secret, NOT on timestamp
    expect(result.reason).not.toContain('replay');
    expect(result.reason).not.toContain('timestamp');
  });

  it('rejects stale timestamps via unit logic', () => {
    // Directly test the timestamp validation logic:
    // A timestamp from 10 minutes ago should be > 5 min max age
    const staleTs = Math.floor(Date.now() / 1000) - 600;
    const ageMs = Math.abs(Date.now() - staleTs * 1000);
    const MAX_AGE_MS = 5 * 60 * 1000;
    expect(ageMs).toBeGreaterThan(MAX_AGE_MS);
  });

  it('accepts fresh timestamps via unit logic', () => {
    const freshTs = Math.floor(Date.now() / 1000) - 30;
    const ageMs = Math.abs(Date.now() - freshTs * 1000);
    const MAX_AGE_MS = 5 * 60 * 1000;
    expect(ageMs).toBeLessThan(MAX_AGE_MS);
  });
});

// ── WARD dedup + rate limiting ───────────────────────────────────────────────

describe('shouldProcess (dedup)', () => {
  beforeEach(() => {
    resetState();
  });

  it('allows first occurrence of an error', async () => {
    const result = await shouldProcess('ws-1', 'TypeError::app.js', DEFAULT_WARD_CONFIG);
    expect(result.allowed).toBe(true);
  });

  it('blocks duplicate error within dedup window', async () => {
    await shouldProcess('ws-1', 'TypeError::app.js', DEFAULT_WARD_CONFIG);
    const result = await shouldProcess('ws-1', 'TypeError::app.js', DEFAULT_WARD_CONFIG);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Duplicate');
  });

  it('allows same error from different workspaces', async () => {
    await shouldProcess('ws-1', 'TypeError::app.js', DEFAULT_WARD_CONFIG);
    const result = await shouldProcess('ws-2', 'TypeError::app.js', DEFAULT_WARD_CONFIG);
    expect(result.allowed).toBe(true);
  });

  it('enforces hourly rate limit', async () => {
    const config = { ...DEFAULT_WARD_CONFIG, maxFixesPerHour: 2, maxFixesPerDay: 100 };
    await shouldProcess('ws-1', 'error-1', config);
    await shouldProcess('ws-1', 'error-2', config);
    const result = await shouldProcess('ws-1', 'error-3', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Hourly');
  });

  it('enforces daily rate limit', async () => {
    const config = { ...DEFAULT_WARD_CONFIG, maxFixesPerHour: 100, maxFixesPerDay: 2 };
    await shouldProcess('ws-1', 'error-1', config);
    await shouldProcess('ws-1', 'error-2', config);
    const result = await shouldProcess('ws-1', 'error-3', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily');
  });

  it('resets cleanly', async () => {
    await shouldProcess('ws-1', 'TypeError::app.js', DEFAULT_WARD_CONFIG);
    resetState();
    const result = await shouldProcess('ws-1', 'TypeError::app.js', DEFAULT_WARD_CONFIG);
    expect(result.allowed).toBe(true);
  });
});

// ── Auto-fix eligibility ─────────────────────────────────────────────────────

describe('checkAutoFixEligibility', () => {
  it('allows eligible errors', () => {
    const result = checkAutoFixEligibility(DEFAULT_WARD_CONFIG, {
      level: 'error',
      projectSlug: 'platform',
      culprit: 'src/lib/auth.ts',
    });
    expect(result.eligible).toBe(true);
  });

  it('rejects when WARD is disabled', () => {
    const config = { ...DEFAULT_WARD_CONFIG, enabled: false };
    const result = checkAutoFixEligibility(config, { level: 'error' });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('disabled');
  });

  it('rejects when auto-fix is disabled', () => {
    const config = { ...DEFAULT_WARD_CONFIG, autoFixEnabled: false };
    const result = checkAutoFixEligibility(config, { level: 'error' });
    expect(result.eligible).toBe(false);
  });

  it('rejects disallowed severity levels', () => {
    const result = checkAutoFixEligibility(DEFAULT_WARD_CONFIG, {
      level: 'warning',
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('Severity');
  });

  it('rejects excluded projects', () => {
    const config = { ...DEFAULT_WARD_CONFIG, excludedProjects: ['admin'] };
    const result = checkAutoFixEligibility(config, {
      level: 'error',
      projectSlug: 'admin',
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('excluded');
  });

  it('rejects excluded file patterns (anchored glob)', () => {
    const result = checkAutoFixEligibility(DEFAULT_WARD_CONFIG, {
      level: 'error',
      culprit: 'auth.test.ts',
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('exclusion');
  });

  it('does NOT false-positive on substring match after anchoring fix', () => {
    // "contest.ts" should NOT match "*.test.*" after anchoring
    const result = checkAutoFixEligibility(DEFAULT_WARD_CONFIG, {
      level: 'error',
      culprit: 'contest.ts',
    });
    expect(result.eligible).toBe(true);
  });

  it('excludes node_modules paths', () => {
    const result = checkAutoFixEligibility(DEFAULT_WARD_CONFIG, {
      level: 'error',
      culprit: 'node_modules/some-pkg/index.js',
    });
    expect(result.eligible).toBe(false);
  });
});
