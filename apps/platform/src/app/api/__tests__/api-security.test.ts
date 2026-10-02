import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock('@/lib/csrf', () => ({
  validateOrigin: vi.fn(() => null),
}));

const mockApplyRateLimit = vi.fn(
  (_a?: unknown, _b?: unknown, _c?: unknown): { blocked: NextResponse } | null => null,
);
vi.mock('@/lib/rate-limiter', () => ({
  applyRateLimit: (a: unknown, b: unknown, c: unknown) => mockApplyRateLimit(a, b, c),
}));

const mockGetAuthUserId = vi.fn((_req?: unknown): string | null => 'user-123');
vi.mock('@/lib/auth', () => ({
  getAuthUserId: (req: unknown) => mockGetAuthUserId(req),
}));

const mockRequirePermission = vi.fn(
  (
    _a?: unknown,
    _b?: unknown,
    _c?: unknown,
  ):
    | NextResponse
    | {
        userId: string;
        resolved: { permissions: Set<unknown>; isOwner: boolean; isPlatformOwner: boolean };
      } => ({
    userId: 'user-123',
    resolved: { permissions: new Set(), isOwner: false, isPlatformOwner: false },
  }),
);
vi.mock('@/lib/permissions', () => ({
  requirePermission: (a: unknown, b: unknown, c: unknown) => mockRequirePermission(a, b, c),
}));

vi.mock('@/lib/api-error', () => ({
  safeErrorResponse: (e: unknown) => {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  },
}));

vi.mock('@/lib/parse-body', () => ({
  parseBody: vi.fn(async (_req: unknown, schema: z.ZodSchema) => {
    // Return a simple parsed body
    return { test: 'value' };
  }),
  isErrorResponse: (v: unknown) => v instanceof NextResponse,
}));

/* ------------------------------------------------------------------ */
/*  Imports (after mocks)                                              */
/* ------------------------------------------------------------------ */

import { withApiSecurity } from '@/lib/api-security';
import { validateOrigin } from '@/lib/csrf';

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('withApiSecurity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserId.mockReturnValue('user-123');
    mockApplyRateLimit.mockReturnValue(null);
    mockRequirePermission.mockReturnValue({
      userId: 'user-123',
      resolved: { permissions: new Set(), isOwner: false, isPlatformOwner: false },
    });
  });

  function makeReq(method = 'GET', path = '/api/test'): NextRequest {
    return new NextRequest(new URL(`http://localhost:3002${path}`), {
      method,
      headers: { 'x-user-id': 'user-123', origin: 'http://localhost:3002' },
    } as never);
  }

  it('calls handler with userId for authenticated GET request', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const route = withApiSecurity(handler);

    const res = await route(makeReq());
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    const [, ctx] = handler.mock.calls[0] as unknown as [unknown, { userId: string }];
    expect(ctx.userId).toBe('user-123');
  });

  it('returns 401 when auth is required and user is not authenticated', async () => {
    mockGetAuthUserId.mockReturnValue(null);
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const route = withApiSecurity(handler);

    const res = await route(makeReq());
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('skips auth when requireAuth is false', async () => {
    mockGetAuthUserId.mockReturnValue(null);
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const route = withApiSecurity(handler, { requireAuth: false });

    const res = await route(makeReq());
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('validates CSRF for POST requests by default', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const route = withApiSecurity(handler);

    await route(makeReq('POST'));
    expect(validateOrigin).toHaveBeenCalled();
  });

  it('does not validate CSRF for GET requests by default', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const route = withApiSecurity(handler);

    await route(makeReq('GET'));
    expect(validateOrigin).not.toHaveBeenCalled();
  });

  it('returns rate limit response when rate limited', async () => {
    mockApplyRateLimit.mockReturnValue({
      blocked: NextResponse.json({ error: 'Rate limited' }, { status: 429 }),
    });
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const route = withApiSecurity(handler, {
      rateLimit: { tier: { limit: 10, windowMs: 60000 }, routeKey: 'test' },
    });

    const res = await route(makeReq());
    expect(res.status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
  });

  it('checks permissions when permission option is set', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const route = withApiSecurity(handler, { permission: 'tasks:read' });

    await route(makeReq());
    expect(mockRequirePermission).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('returns permission error when permission check fails', async () => {
    mockRequirePermission.mockReturnValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const route = withApiSecurity(handler, { permission: 'tasks:read' });

    const res = await route(makeReq());
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('catches handler errors and returns safe error response', async () => {
    const handler = vi.fn(async () => {
      throw new Error('Something broke');
    });
    const route = withApiSecurity(handler);

    const res = await route(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Something broke');
  });
});
