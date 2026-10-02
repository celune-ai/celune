/**
 * Tests for workspace and invitation routes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'ws-user-001';
const TEST_ORG_ID = 'ws-org-001';
const TEST_WORKSPACE_ID = '00000000-0000-0000-0000-000000001111';

// ---------------------------------------------------------------------------
// Mock: auth
// ---------------------------------------------------------------------------

const mockGetAuthUserId = vi.fn((_req?: unknown): string | null => TEST_USER_ID);

vi.mock('@/lib/auth', () => ({
  getAuthUserId: (req: unknown) => mockGetAuthUserId(req),
}));

// ---------------------------------------------------------------------------
// Mock: CSRF
// ---------------------------------------------------------------------------

vi.mock('@/lib/csrf', () => ({
  validateOrigin: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Mock: api-error
// ---------------------------------------------------------------------------

vi.mock('@/lib/api-error', async () => {
  const { NextResponse: NR } = await import('next/server');
  return {
    safeErrorResponse: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NR.json({ error: msg }, { status: 500 });
    },
  };
});

// ---------------------------------------------------------------------------
// Mock: rate-limiter
// ---------------------------------------------------------------------------

vi.mock('@/lib/rate-limiter', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_WRITE: { limit: 60, windowMs: 60000 },
}));

// ---------------------------------------------------------------------------
// Mock: permissions
// ---------------------------------------------------------------------------

const mockRequirePermission = vi.fn(
  async (
    _a?: unknown,
    _b?: unknown,
    _c?: unknown,
  ): Promise<NextResponse | { userId: string; workspaceId: string; orgId: string }> => ({
    userId: TEST_USER_ID,
    workspaceId: TEST_WORKSPACE_ID,
    orgId: TEST_ORG_ID,
  }),
);

const notPlatformOwner = {
  role: null,
  permissions: new Set<string>(),
  isOwner: false,
  isPlatformOwner: false,
};
const mockResolvePermissions = vi.fn(async () => notPlatformOwner);

vi.mock('@/lib/permissions', () => ({
  requirePermission: (a: unknown, b: unknown, c: unknown) => mockRequirePermission(a, b, c),
  resolvePermissions: () => mockResolvePermissions(),
  resolveOrgPermissions: async () => ({ ...notPlatformOwner, roleSlug: null }),
}));

// ---------------------------------------------------------------------------
// Mock: require-workspace
// ---------------------------------------------------------------------------

vi.mock('@/lib/require-workspace', () => ({
  extractRequiredWorkspaceId: vi.fn(() => TEST_WORKSPACE_ID),
  extractWorkspaceScope: vi.fn(() => ({ workspace_id: TEST_WORKSPACE_ID })),
  requireWorkspaceMembership: vi.fn(async () => null),
}));

// ---------------------------------------------------------------------------
// Mock: agent-seed
// ---------------------------------------------------------------------------

vi.mock('@/lib/agent-seed', () => ({
  seedDefaultAgents: vi.fn(async () => ({ seeded: 2, skipped: 0, agentIds: ['lead', 'reviewer'] })),
  copyAgentsFromWorkspace: vi.fn(async () => ({ copied: 2, skipped: 0 })),
}));

// ---------------------------------------------------------------------------
// Mock: api-security (withApiSecurity wrapper)
// ---------------------------------------------------------------------------

vi.mock('@/lib/api-security', async () => {
  const { NextResponse: NR } = await import('next/server');
  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    withApiSecurity: (handler: Function, _opts: unknown) => {
      return async (request: NextRequest) => {
        const userId = mockGetAuthUserId();
        if (!userId) return NR.json({ error: 'Unauthorized' }, { status: 401 });
        try {
          const body = request.method === 'POST' ? await request.clone().json() : undefined;
          return handler(request, { userId, body, workspaceId: null, orgId: TEST_ORG_ID });
        } catch {
          return NR.json({ error: 'Bad request' }, { status: 400 });
        }
      };
    },
  };
});

// ---------------------------------------------------------------------------
// Mock: @repo/types
// ---------------------------------------------------------------------------

vi.mock('@repo/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/types')>();
  return { ...actual };
});

// ---------------------------------------------------------------------------
// Mock: Supabase
// ---------------------------------------------------------------------------

const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
const mockEq = vi.fn().mockReturnThis();
const mockLimit = vi.fn().mockReturnThis();
const mockOrder = vi.fn().mockReturnThis();
const mockSelect = vi.fn(() => ({
  eq: mockEq,
  in: vi.fn().mockReturnThis(),
  order: mockOrder,
  limit: mockLimit,
}));
const mockInsert = vi.fn(() => ({ select: mockSelect }));

function resetChain() {
  mockSelect.mockReturnValue({
    eq: mockEq,
    in: vi.fn().mockReturnThis(),
    order: mockOrder,
    limit: mockLimit,
  });
  mockEq.mockReturnValue({
    eq: mockEq,
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
    order: mockOrder,
    limit: mockLimit,
  });
  mockOrder.mockReturnValue({
    order: mockOrder,
    limit: mockLimit,
    eq: mockEq,
    maybeSingle: mockMaybeSingle,
  });
  mockLimit.mockReturnValue({
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
  });
  mockInsert.mockReturnValue({ select: mockSelect });
  mockSingle.mockResolvedValue({ data: null, error: null });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
}

vi.mock('@repo/db/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: mockSelect,
      insert: mockInsert,
      update: vi.fn(() => ({ eq: mockEq })),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    })),
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({
          data: { users: [] },
          error: null,
        })),
      },
    },
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'), init as never);
}

function postJson(url: string, body: Record<string, unknown>): NextRequest {
  return makeRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-id': TEST_USER_ID },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetChain();
  mockGetAuthUserId.mockReturnValue(TEST_USER_ID);
});

// ---------------------------------------------------------------------------
// Tests: GET /api/workspaces
// ---------------------------------------------------------------------------

describe('GET /api/workspaces — list workspaces', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('../../api/workspaces/route');
    GET = mod.GET;
  });

  it('returns 401 for unauthenticated users', async () => {
    mockGetAuthUserId.mockReturnValue(null);
    const req = makeRequest('http://localhost:3002/api/workspaces');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 404 when user has no organization', async () => {
    // org_members returns no active membership
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req = makeRequest('http://localhost:3002/api/workspaces');
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it('returns 404 when user account is deactivated', async () => {
    // org_members query with is_active=true filter returns no rows for deactivated users
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const req = makeRequest('http://localhost:3002/api/workspaces');
    const res = await GET(req);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/workspaces — workspace creation
// ---------------------------------------------------------------------------

describe('POST /api/workspaces — create workspace', () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('../../api/workspaces/route');
    POST = mod.POST;
  });

  it('returns 401 when not authenticated', async () => {
    mockGetAuthUserId.mockReturnValue(null);
    const req = postJson('http://localhost:3002/api/workspaces', { name: 'Test' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 404 when user has no org', async () => {
    // withApiSecurity mock passes, handler calls org_members which returns null
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const req = postJson('http://localhost:3002/api/workspaces', { name: 'New Workspace' });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/workspace-members
// ---------------------------------------------------------------------------

describe('GET /api/workspace-members — list members', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('../../api/workspace-members/route');
    GET = mod.GET;
  });

  it('returns 403 when permission denied', async () => {
    mockRequirePermission.mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );

    const req = makeRequest(
      `http://localhost:3002/api/workspace-members?workspace_id=${TEST_WORKSPACE_ID}`,
    );
    const res = await GET(req);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/invitations — list invitations
// ---------------------------------------------------------------------------

describe('GET /api/invitations — list pending invitations', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('../../api/invitations/route');
    GET = mod.GET;
  });

  it('returns 403 when the caller holds users:invite in no org', async () => {
    const req = makeRequest('http://localhost:3002/api/invitations');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('returns empty invitations list when no pending users', async () => {
    mockResolvePermissions.mockResolvedValueOnce({ ...notPlatformOwner, isPlatformOwner: true });
    const req = makeRequest('http://localhost:3002/api/invitations');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invitations).toEqual([]);
  });
});
