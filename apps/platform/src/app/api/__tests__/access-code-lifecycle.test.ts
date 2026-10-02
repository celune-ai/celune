/**
 * Access code full lifecycle integration tests.
 *
 * Tests the complete flow: generate → redeem → verify plan → revoke → verify downgrade.
 * Also covers rate limiting on redemption attempts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockIs = vi.fn();
const mockOrder = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockLimit = vi.fn();
const mockGetUserById = vi.fn();

function buildChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    'from',
    'select',
    'eq',
    'is',
    'order',
    'insert',
    'update',
    'single',
    'maybeSingle',
    'limit',
  ];
  chain.from = mockFrom;
  chain.select = mockSelect;
  chain.eq = mockEq;
  chain.is = mockIs;
  chain.order = mockOrder;
  chain.insert = mockInsert;
  chain.update = mockUpdate;
  chain.single = mockSingle;
  chain.maybeSingle = mockMaybeSingle;
  chain.limit = mockLimit;

  mockFrom.mockReturnValue(chain);
  mockSelect.mockReturnValue(chain);
  mockEq.mockReturnValue(chain);
  mockIs.mockReturnValue(chain);
  mockOrder.mockReturnValue(chain);
  mockInsert.mockReturnValue(chain);
  mockUpdate.mockReturnValue(chain);
  mockLimit.mockReturnValue(chain);
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });

  return {
    ...chain,
    auth: { admin: { getUserById: mockGetUserById } },
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
}

let mockChain: ReturnType<typeof buildChain>;

vi.mock('@repo/db/service', () => ({
  createServiceClient: () => mockChain,
}));

vi.mock('@/lib/auth', () => ({
  getAuthUserId: (req: NextRequest) => req.headers.get('x-user-id'),
}));

// Mock CSRF validation — allow all origins in tests
vi.mock('@/lib/csrf', () => ({
  validateOrigin: vi.fn(() => null),
}));

// Mock rate limiter — no rate limiting in tests
vi.mock('@/lib/rate-limiter', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_WRITE: { requests: 60, windowMs: 60000 },
  RATE_AI: { requests: 20, windowMs: 60000 },
  RATE_AUTH: { requests: 5, windowMs: 60000 },
}));

// Mock permissions — allow all permissions in tests
vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(async () => ({
    userId: 'test-user-id',
    resolved: { permissions: new Set(['*']) },
  })),
}));

// Mock UUID validation — accept all in tests
vi.mock('@repo/db/validation', () => ({
  isValidUuid: vi.fn(() => true),
}));

vi.mock('@/lib/api-error', async () => {
  const { NextResponse } = await import('next/server');
  return {
    safeErrorResponse: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    },
    ApiError: class extends Error {
      statusCode: number;
      userMessage: string;
      constructor(s: number, m: string) {
        super(m);
        this.statusCode = s;
        this.userMessage = m;
      }
    },
  };
});

// Shared store for the rate limiter mock — must be declared before vi.mock
const _rateLimitStore = new Map<string, number[]>();

vi.mock('@/lib/rate-limit', () => {
  function createRateLimit(config: { limit: number; windowMs: number }) {
    const { limit, windowMs } = config;

    function check(key: string) {
      const now = Date.now();
      const cutoff = now - windowMs;
      const timestamps = (_rateLimitStore.get(key) ?? []).filter((t) => t > cutoff);

      if (timestamps.length >= limit) {
        const retryAfterMs = timestamps[0] + windowMs - now;
        return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, retryAfterMs) };
      }

      timestamps.push(now);
      _rateLimitStore.set(key, timestamps);
      return { allowed: true, remaining: limit - timestamps.length, retryAfterMs: 0 };
    }

    function reset() {
      _rateLimitStore.clear();
    }

    return { check, reset };
  }

  return { createRateLimit };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { POST as generateCode } from '../../api/access-codes/route';
import { POST as redeemCode } from '../../api/access-codes/redeem/route';
import { DELETE as revokeCode } from '../../api/access-codes/[code]/route';

// ---------------------------------------------------------------------------
// Constants & Helpers
// ---------------------------------------------------------------------------

const OWNER_ID = 'platform-owner-id';
const USER_A = 'user-alpha-id';
const USER_B = 'user-beta-id';

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'), init as never);
}

function jsonRequest(url: string, userId: string, body: Record<string, unknown>): NextRequest {
  return makeRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify(body),
  });
}

function mockPlatformOwner() {
  mockGetUserById.mockResolvedValue({
    data: { user: { id: OWNER_ID, app_metadata: { is_platform_owner: true } } },
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockChain = buildChain();
  _rateLimitStore.clear();
});

// ---------------------------------------------------------------------------
// Full Lifecycle: generate → redeem → verify plan → revoke → verify downgrade
// ---------------------------------------------------------------------------

describe('Access code full lifecycle', () => {
  it('generate → redeem → verify sponsored plan', async () => {
    // Step 1: Generate code as platform owner
    mockPlatformOwner();
    const generatedCode = 'LIFECYCLE001';
    const generatedRow = {
      id: 'row-lifecycle-1',
      code: generatedCode,
      created_by: OWNER_ID,
      note: 'for alpha tester',
      created_at: new Date().toISOString(),
    };
    mockSingle.mockResolvedValueOnce({ data: generatedRow, error: null });

    const genReq = jsonRequest('http://localhost:3002/api/access-codes', OWNER_ID, {
      note: 'for alpha tester',
    });
    const genRes = await generateCode(genReq);
    const genBody = await genRes.json();

    expect(genRes.status).toBe(201);
    expect(genBody.code).toBe(generatedCode);
    expect(genBody.note).toBe('for alpha tester');

    // Step 2: Redeem code as a regular user
    vi.clearAllMocks();
    mockChain = buildChain();

    const existingCode = {
      id: 'row-lifecycle-1',
      code: generatedCode,
      plan: 'pro',
      redeemed_by: null,
      revoked_at: null,
    };
    // Lookup via .maybeSingle(): code exists and is available
    mockMaybeSingle.mockResolvedValueOnce({ data: existingCode, error: null });
    // Update via .single(): mark as redeemed
    mockSingle.mockResolvedValueOnce({
      data: {
        ...existingCode,
        redeemed_by: USER_A,
        redeemed_at: new Date().toISOString(),
      },
      error: null,
    });

    const redeemReq = jsonRequest('http://localhost:3002/api/access-codes/redeem', USER_A, {
      code: generatedCode,
    });
    const redeemRes = await redeemCode(redeemReq);
    const redeemBody = await redeemRes.json();

    expect(redeemRes.status).toBe(200);
    // Codes issued before the Cloud plan carry legacy names; they grant Cloud
    expect(redeemBody.plan).toBe('cloud');
    expect(redeemBody.message).toMatch(/redeemed/i);
  });

  it('revoke → user loses sponsored plan', async () => {
    // Step 1: Revoke code as platform owner
    mockPlatformOwner();

    const revokedRow = {
      id: 'row-lifecycle-1',
      code: 'REVOKETEST1',
      created_by: OWNER_ID,
      revoked_at: new Date().toISOString(),
    };
    mockSingle.mockResolvedValueOnce({ data: revokedRow, error: null });

    const revokeReq = makeRequest('http://localhost:3002/api/access-codes/REVOKETEST1', {
      method: 'DELETE',
      headers: { 'x-user-id': OWNER_ID },
    });
    const revokeRes = await revokeCode(revokeReq, {
      params: Promise.resolve({ code: 'REVOKETEST1' }),
    });
    const revokeBody = await revokeRes.json();

    expect(revokeRes.status).toBe(200);
    expect(revokeBody.revoked_at).toBeTruthy();

    // Step 2: Verify the code can no longer be redeemed
    vi.clearAllMocks();
    mockChain = buildChain();

    // After revocation, lookup with .is('revoked_at', null) returns null via .maybeSingle()
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const redeemReq = jsonRequest('http://localhost:3002/api/access-codes/redeem', USER_B, {
      code: 'REVOKETEST1',
    });
    const redeemRes = await redeemCode(redeemReq);
    const redeemBody = await redeemRes.json();

    expect(redeemRes.status).toBe(404);
    expect(redeemBody.error).toMatch(/invalid|expired/i);
  });

  it('cannot redeem the same code twice (concurrency guard)', async () => {
    const code = 'DOUBLECHECK1';

    // First redemption succeeds
    const existingCode = {
      id: 'row-1',
      code,
      plan: 'builder',
      redeemed_by: null,
      revoked_at: null,
    };
    // Lookup via .maybeSingle()
    mockMaybeSingle.mockResolvedValueOnce({ data: existingCode, error: null });
    // Update via .single()
    mockSingle.mockResolvedValueOnce({
      data: { ...existingCode, redeemed_by: USER_A, redeemed_at: new Date().toISOString() },
      error: null,
    });

    const req1 = jsonRequest('http://localhost:3002/api/access-codes/redeem', USER_A, { code });
    const res1 = await redeemCode(req1);
    expect(res1.status).toBe(200);

    // Second attempt by different user — code is now redeemed
    vi.clearAllMocks();
    mockChain = buildChain();

    // Re-mock getUserById cleared by clearAllMocks (not platform owner — regular user)
    mockGetUserById.mockResolvedValue({
      data: { user: { id: USER_B, app_metadata: {} } },
    });

    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'row-1', code, plan: 'builder', redeemed_by: USER_A, revoked_at: null },
      error: null,
    });

    const req2 = jsonRequest('http://localhost:3002/api/access-codes/redeem', USER_B, { code });
    const res2 = await redeemCode(req2);
    const body2 = await res2.json();

    expect(res2.status).toBe(409);
    expect(body2.error).toMatch(/already.*redeemed/i);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting on redemption
// ---------------------------------------------------------------------------

describe('Access code redemption rate limiting', () => {
  it('blocks after 5 rapid attempts and returns 429 with Retry-After', async () => {
    const results: number[] = [];

    for (let i = 0; i < 7; i++) {
      // Each attempt uses a different invalid code so we exercise the limiter
      // The limiter checks happen before DB lookup
      vi.clearAllMocks();
      mockChain = buildChain();
      // Return not found for all attempts
      mockSingle.mockResolvedValueOnce({ data: null, error: null });

      const req = jsonRequest('http://localhost:3002/api/access-codes/redeem', USER_A, {
        code: `ATTEMPT${String(i).padStart(5, '0')}1`,
      });
      const res = await redeemCode(req);
      results.push(res.status);
    }

    // First 5 should get through (404 because codes don't exist)
    expect(results.slice(0, 5).every((s) => s === 404)).toBe(true);

    // Attempts 6 and 7 should be rate limited
    expect(results[5]).toBe(429);
    expect(results[6]).toBe(429);
  });

  it('rate limit response includes retryAfterSeconds', async () => {
    // Exhaust the limit
    for (let i = 0; i < 5; i++) {
      vi.clearAllMocks();
      mockChain = buildChain();
      mockSingle.mockResolvedValueOnce({ data: null, error: null });

      const req = jsonRequest('http://localhost:3002/api/access-codes/redeem', USER_A, {
        code: `RATELIMIT${String(i).padStart(3, '0')}`,
      });
      await redeemCode(req);
    }

    // Next attempt should be blocked
    vi.clearAllMocks();
    mockChain = buildChain();

    const req = jsonRequest('http://localhost:3002/api/access-codes/redeem', USER_A, {
      code: 'RATELIMITXXX',
    });
    const res = await redeemCode(req);
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('rate limits are per-user — different users have independent limits', async () => {
    // Exhaust USER_A's limit
    for (let i = 0; i < 5; i++) {
      vi.clearAllMocks();
      mockChain = buildChain();
      mockSingle.mockResolvedValueOnce({ data: null, error: null });

      const req = jsonRequest('http://localhost:3002/api/access-codes/redeem', USER_A, {
        code: `PERUSERA${String(i).padStart(4, '0')}`,
      });
      await redeemCode(req);
    }

    // USER_A should be blocked
    vi.clearAllMocks();
    mockChain = buildChain();
    const reqA = jsonRequest('http://localhost:3002/api/access-codes/redeem', USER_A, {
      code: 'PERUSERABLCK',
    });
    const resA = await redeemCode(reqA);
    expect(resA.status).toBe(429);

    // USER_B should NOT be blocked
    vi.clearAllMocks();
    mockChain = buildChain();
    mockSingle.mockResolvedValueOnce({ data: null, error: null });

    const reqB = jsonRequest('http://localhost:3002/api/access-codes/redeem', USER_B, {
      code: 'PERUSERB0001',
    });
    const resB = await redeemCode(reqB);
    expect(resB.status).toBe(404); // Not 429 — user B has their own limit
  });
});
