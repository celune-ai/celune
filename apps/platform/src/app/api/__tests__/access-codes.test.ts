/**
 * Integration tests for access code generation, redemption, and revocation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Each test gets a fresh mock Supabase via createServiceClient().
// We track calls and return values through these fns.
const mockSingle = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockNeq = vi.fn();
const mockIs = vi.fn();
const mockOrder = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockGetUserById = vi.fn();

function buildChain() {
  const chain = {
    from: mockFrom,
    select: mockSelect,
    eq: mockEq,
    neq: mockNeq,
    is: mockIs,
    order: mockOrder,
    insert: mockInsert,
    update: mockUpdate,
    single: mockSingle,
    maybeSingle: mockSingle, // maybeSingle uses same mock as single
    auth: { admin: { getUserById: mockGetUserById } },
  };
  // All chain methods return the chain itself (except single/maybeSingle which resolves)
  mockFrom.mockReturnValue(chain);
  mockSelect.mockReturnValue(chain);
  mockEq.mockReturnValue(chain);
  mockNeq.mockReturnValue(chain);
  mockIs.mockReturnValue(chain);
  mockOrder.mockReturnValue(chain);
  mockInsert.mockReturnValue(chain);
  mockUpdate.mockReturnValue(chain);
  return chain;
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

// Mock the rate limiter so it always allows requests
vi.mock('@/lib/rate-limit', () => ({
  createRateLimit: () => ({
    check: () => ({ allowed: true, remaining: 99, retryAfterMs: 0 }),
    reset: () => {},
  }),
}));

// ---------------------------------------------------------------------------
// Imports (must come after vi.mock calls)
// ---------------------------------------------------------------------------

import { POST as generateCode } from '../../api/access-codes/route';
import { POST as redeemCode } from '../../api/access-codes/redeem/route';
import { DELETE as revokeCode } from '../../api/access-codes/[code]/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNER_ID = 'owner-user-id';
const USER_ID = 'regular-user-id';

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'), init as never);
}

function mockPlatformOwner() {
  mockGetUserById.mockResolvedValue({
    data: { user: { id: OWNER_ID, app_metadata: { is_platform_owner: true } } },
  });
}

function mockNonOwner() {
  mockGetUserById.mockResolvedValue({
    data: { user: { id: USER_ID, app_metadata: {} } },
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockChain = buildChain();
});

// ---------------------------------------------------------------------------
// 1. Generate — POST /api/access-codes
// ---------------------------------------------------------------------------

describe('POST /api/access-codes (generate)', () => {
  it('creates a 12-char alphanumeric code for platform owner', async () => {
    mockPlatformOwner();

    const generatedRow = {
      id: 'row-1',
      code: 'ABCDEF123456',
      created_by: OWNER_ID,
      note: null,
      created_at: new Date().toISOString(),
    };
    mockSingle.mockResolvedValueOnce({ data: generatedRow, error: null });

    const req = makeRequest('http://localhost:3002/api/access-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': OWNER_ID },
      body: JSON.stringify({}),
    });

    const res = await generateCode(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.code).toBe('ABCDEF123456');
    expect(body.created_by).toBe(OWNER_ID);

    // Verify insert was called on the access_codes table
    expect(mockFrom).toHaveBeenCalledWith('access_codes');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        created_by: OWNER_ID,
        // base64url alphabet: A-Z, 0-9, hyphen, underscore (uppercased)
        code: expect.stringMatching(/^[A-Z0-9_-]{12}$/),
      }),
    );
  });

  it('returns 401 when no user is authenticated', async () => {
    const req = makeRequest('http://localhost:3002/api/access-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await generateCode(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-owner users', async () => {
    mockNonOwner();

    const req = makeRequest('http://localhost:3002/api/access-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': USER_ID },
      body: JSON.stringify({}),
    });

    const res = await generateCode(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toMatch(/owner/i);
  });
});

// ---------------------------------------------------------------------------
// 2. Redeem — POST /api/access-codes/redeem
// ---------------------------------------------------------------------------

describe('POST /api/access-codes/redeem', () => {
  it('returns success and sponsored plan for a valid code', async () => {
    const existing = {
      id: 'row-1',
      code: 'VALIDCODE123',
      plan: 'pro',
      redeemed_by: null,
      revoked_at: null,
    };

    // First .maybeSingle() call: lookup
    mockSingle.mockResolvedValueOnce({ data: existing, error: null });
    // Second .single() call: update
    mockSingle.mockResolvedValueOnce({
      data: { ...existing, redeemed_by: USER_ID, redeemed_at: new Date().toISOString() },
      error: null,
    });

    const req = makeRequest('http://localhost:3002/api/access-codes/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': USER_ID },
      body: JSON.stringify({ code: 'VALIDCODE123' }),
    });

    const res = await redeemCode(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    // Codes issued before the Cloud plan carry legacy names; they grant Cloud
    expect(body.plan).toBe('cloud');
    expect(body.message).toMatch(/redeemed/i);
  });

  it('returns 409 when code has already been redeemed', async () => {
    const existing = {
      id: 'row-1',
      code: 'USEDCODE1234',
      redeemed_by: 'another-user',
      revoked_at: null,
    };

    // Lookup returns a code that is already redeemed
    mockSingle.mockResolvedValueOnce({ data: existing, error: null });

    const req = makeRequest('http://localhost:3002/api/access-codes/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': USER_ID },
      body: JSON.stringify({ code: 'USEDCODE1234' }),
    });

    const res = await redeemCode(req);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/already.*redeemed/i);
  });

  it('returns 404 for a nonexistent code', async () => {
    // Lookup returns null (no matching code)
    mockSingle.mockResolvedValueOnce({ data: null, error: null });

    const req = makeRequest('http://localhost:3002/api/access-codes/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': USER_ID },
      body: JSON.stringify({ code: 'DOESNTEXIST1' }),
    });

    const res = await redeemCode(req);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/invalid|expired/i);
  });

  it('returns 400 for code that is too short', async () => {
    const req = makeRequest('http://localhost:3002/api/access-codes/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': USER_ID },
      body: JSON.stringify({ code: 'SHORT' }),
    });

    const res = await redeemCode(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 for code with special characters', async () => {
    const req = makeRequest('http://localhost:3002/api/access-codes/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': USER_ID },
      body: JSON.stringify({ code: 'CODE!@#$ABCD' }),
    });

    const res = await redeemCode(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('returns 404 when redeeming a revoked code', async () => {
    // A revoked code has revoked_at set, so the query with .is('revoked_at', null) returns null
    mockSingle.mockResolvedValueOnce({ data: null, error: null });

    const req = makeRequest('http://localhost:3002/api/access-codes/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': USER_ID },
      body: JSON.stringify({ code: 'REVOKEDCODE1' }),
    });

    const res = await redeemCode(req);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/invalid|expired/i);
  });

  it('returns 401 when no user is authenticated', async () => {
    const req = makeRequest('http://localhost:3002/api/access-codes/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'VALIDCODE123' }),
    });

    const res = await redeemCode(req);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 3. Revoke — DELETE /api/access-codes/[code]
// ---------------------------------------------------------------------------

describe('DELETE /api/access-codes/[code] (revoke)', () => {
  it('soft-deletes the code by setting revoked_at', async () => {
    mockPlatformOwner();

    const revokedRow = {
      id: 'row-1',
      code: 'TOBREVOKED12',
      created_by: OWNER_ID,
      revoked_at: new Date().toISOString(),
    };
    mockSingle.mockResolvedValueOnce({ data: revokedRow, error: null });

    const req = makeRequest('http://localhost:3002/api/access-codes/TOBREVOKED12', {
      method: 'DELETE',
      headers: { 'x-user-id': OWNER_ID },
    });

    const res = await revokeCode(req, { params: Promise.resolve({ code: 'TOBREVOKED12' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.revoked_at).toBeTruthy();

    // Verify update was called with revoked_at
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ revoked_at: expect.any(String) }),
    );
  });

  it('returns 404 when code does not exist or is already revoked', async () => {
    mockPlatformOwner();

    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });

    const req = makeRequest('http://localhost:3002/api/access-codes/NOSUCHCODE12', {
      method: 'DELETE',
      headers: { 'x-user-id': OWNER_ID },
    });

    const res = await revokeCode(req, { params: Promise.resolve({ code: 'NOSUCHCODE12' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/not found|already revoked/i);
  });

  it('returns 403 for non-owner users', async () => {
    mockNonOwner();

    const req = makeRequest('http://localhost:3002/api/access-codes/SOMECODE1234', {
      method: 'DELETE',
      headers: { 'x-user-id': USER_ID },
    });

    const res = await revokeCode(req, { params: Promise.resolve({ code: 'SOMECODE1234' }) });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toMatch(/owner/i);
  });
});
