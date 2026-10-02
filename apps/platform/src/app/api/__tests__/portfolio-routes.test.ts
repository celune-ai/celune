import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Portfolio Routes Tests
 *
 * Tests workspace-scoped portfolio password CRUD and public verify endpoint.
 * Covers auth, workspace membership, validation, and CORS behavior.
 */

const WS_ID = 'aaaaaaaa-0000-4000-a000-000000000001';
const USER_ID = 'test-user-id';
const PASSWORD_ID = 'cccccccc-0000-4000-a000-000000000003';

// --- Mocks ---

vi.mock('@/lib/csrf', () => ({ validateOrigin: () => null }));
vi.mock('@/lib/rate-limiter', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_WRITE: { requests: 60, windowMs: 60000 },
  RATE_AUTH: { limit: 5, windowMs: 60000 },
}));

vi.mock('@repo/db/validation', () => ({
  isValidUuid: (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
}));

vi.mock('@/lib/schemas/portfolio.schema', () => ({
  createPortfolioPasswordSchema: {},
  updatePortfolioPasswordSchema: {},
  verifyPortfolioPasswordSchema: {},
}));

vi.mock('@/lib/require-workspace', () => ({
  extractRequiredWorkspaceId: vi.fn((req: { nextUrl: { searchParams: URLSearchParams } }) => {
    const wsId = req.nextUrl.searchParams.get('workspace_id');
    if (!wsId) {
      const { NextResponse } = require('next/server');
      return NextResponse.json(
        { error: 'workspace_id query parameter is required' },
        { status: 400 },
      );
    }
    return wsId;
  }),
  requireWorkspaceMembership: vi.fn(async () => null), // allow by default
}));

vi.mock('@/lib/api-error', async () => {
  const { NextResponse } = await import('next/server');
  return {
    safeErrorResponse: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    },
  };
});

const mockGetAuthUserId = vi.fn((): string | null => USER_ID);
vi.mock('@/lib/auth', () => ({
  getAuthUserId: (...args: unknown[]) => mockGetAuthUserId(...(args as [])),
}));

// Track Supabase calls
let mockSupabaseData: unknown = null;
let mockSupabaseError: unknown = null;
let mockInsertData: unknown = null;
const mockEq = vi.fn().mockReturnThis();
const mockSelect = vi.fn().mockReturnThis();
const mockOrder = vi.fn().mockReturnThis();
const mockSingle = vi.fn(async () => ({
  data: mockSupabaseData,
  error: mockSupabaseError,
}));
const mockInsert = vi.fn(() => ({
  select: vi.fn(() => ({
    single: vi.fn(async () => ({
      data: mockInsertData,
      error: mockSupabaseError,
    })),
  })),
}));
const mockUpdate = vi.fn(() => ({
  eq: vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: mockSupabaseData,
          error: mockSupabaseError,
        })),
      })),
    })),
  })),
}));
const mockDelete = vi.fn(() => ({
  eq: vi.fn(() => ({
    eq: vi.fn(async () => ({
      error: mockSupabaseError,
    })),
  })),
}));

vi.mock('@repo/db/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'portfolio_passwords') {
        return {
          select: mockSelect,
          eq: mockEq,
          order: mockOrder,
          single: mockSingle,
          insert: mockInsert,
          update: mockUpdate,
          delete: mockDelete,
        };
      }
      // workspace_memberships / workspaces / org_memberships for membership checks
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => ({
          data: { id: 'membership-id', org_id: 'org-1', role: 'owner' },
          error: null,
        })),
      };
    },
  }),
}));

vi.mock('@/lib/password-hash', () => ({
  createPasswordHash: vi.fn(async () => 'hashed-password'),
  verifyPasswordHash: vi.fn(async (_pw: string, hash: string) => hash === 'correct-hash'),
}));

// parseBody: pass-through that applies basic Zod validation
vi.mock('@/lib/parse-body', () => ({
  parseBody: vi.fn(async (req: Request, _schema: unknown) => {
    const body = await req.json();
    return body;
  }),
}));

function makeRequest(
  path: string,
  method: string,
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
): NextRequest {
  const url = `http://localhost:3002${path}`;
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) (init as Record<string, unknown>).body = JSON.stringify(body);
  return new NextRequest(url, init as never);
}

// --- Tests ---

describe('Portfolio Password Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseData = null;
    mockSupabaseError = null;
    mockInsertData = null;
    mockGetAuthUserId.mockReturnValue(USER_ID);
  });

  describe('GET /api/portfolio/passwords', () => {
    it('returns 401 when unauthenticated', async () => {
      mockGetAuthUserId.mockReturnValue(null);
      const { GET } = await import('../portfolio/passwords/route');
      const req = makeRequest(`/api/portfolio/passwords?workspace_id=${WS_ID}`, 'GET');
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it('returns 400 when workspace_id is missing', async () => {
      const { GET } = await import('../portfolio/passwords/route');
      const req = makeRequest('/api/portfolio/passwords', 'GET');
      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    it('returns passwords for authenticated workspace member', async () => {
      // Mock the chained select().eq().order() returning data
      const mockData = [
        { id: PASSWORD_ID, project_id: 'proj-1', workspace_id: WS_ID, created_at: '2026-01-01' },
      ];
      mockOrder.mockResolvedValueOnce({ data: mockData, error: null });

      const { GET } = await import('../portfolio/passwords/route');
      const req = makeRequest(`/api/portfolio/passwords?workspace_id=${WS_ID}`, 'GET');
      const res = await GET(req);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/portfolio/passwords', () => {
    it('returns 401 when unauthenticated', async () => {
      mockGetAuthUserId.mockReturnValue(null);
      const { POST } = await import('../portfolio/passwords/route');
      const req = makeRequest(`/api/portfolio/passwords?workspace_id=${WS_ID}`, 'POST', {
        project_id: 'bbbbbbbb-0000-4000-a000-000000000002',
        password: 'test-password',
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it('creates a password for authenticated member', async () => {
      mockInsertData = {
        id: PASSWORD_ID,
        project_id: 'bbbbbbbb-0000-4000-a000-000000000002',
        workspace_id: WS_ID,
        created_at: '2026-01-01',
      };

      const { POST } = await import('../portfolio/passwords/route');
      const req = makeRequest(`/api/portfolio/passwords?workspace_id=${WS_ID}`, 'POST', {
        project_id: 'bbbbbbbb-0000-4000-a000-000000000002',
        password: 'my-secret',
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
    });
  });

  describe('PATCH /api/portfolio/passwords/[id]', () => {
    it('returns 401 when unauthenticated', async () => {
      mockGetAuthUserId.mockReturnValue(null);
      const { PATCH } = await import('../portfolio/passwords/[id]/route');
      const req = makeRequest(
        `/api/portfolio/passwords/${PASSWORD_ID}?workspace_id=${WS_ID}`,
        'PATCH',
        { password: 'new-password' },
      );
      const res = await PATCH(req, { params: Promise.resolve({ id: PASSWORD_ID }) });
      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid UUID', async () => {
      const { PATCH } = await import('../portfolio/passwords/[id]/route');
      const req = makeRequest(
        `/api/portfolio/passwords/not-a-uuid?workspace_id=${WS_ID}`,
        'PATCH',
        { password: 'new-password' },
      );
      const res = await PATCH(req, { params: Promise.resolve({ id: 'not-a-uuid' }) });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/portfolio/passwords/[id]', () => {
    it('returns 401 when unauthenticated', async () => {
      mockGetAuthUserId.mockReturnValue(null);
      const { DELETE } = await import('../portfolio/passwords/[id]/route');
      const req = makeRequest(
        `/api/portfolio/passwords/${PASSWORD_ID}?workspace_id=${WS_ID}`,
        'DELETE',
      );
      const res = await DELETE(req, { params: Promise.resolve({ id: PASSWORD_ID }) });
      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid UUID', async () => {
      const { DELETE } = await import('../portfolio/passwords/[id]/route');
      const req = makeRequest(`/api/portfolio/passwords/bad-id?workspace_id=${WS_ID}`, 'DELETE');
      const res = await DELETE(req, { params: Promise.resolve({ id: 'bad-id' }) });
      expect(res.status).toBe(400);
    });
  });
});

describe('Portfolio Verify Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies rate limiting', async () => {
    const { applyRateLimit } = await import('@/lib/rate-limiter');
    const { POST } = await import('../portfolio/verify/route');
    const req = makeRequest('/api/portfolio/verify', 'POST', {
      project_id: 'bbbbbbbb-0000-4000-a000-000000000002',
      password: 'test',
      workspace_id: WS_ID,
    });
    await POST(req);
    expect(applyRateLimit).toHaveBeenCalled();
  });

  it('handles OPTIONS preflight', async () => {
    const { OPTIONS } = await import('../portfolio/verify/route');
    const req = new Request('http://localhost/api/portfolio/verify', {
      method: 'OPTIONS',
      headers: { origin: 'https://app.celune.ai' },
    }) as unknown as import('next/server').NextRequest;
    const res = await OPTIONS(req);
    expect(res.status).toBe(204);
  });
});
