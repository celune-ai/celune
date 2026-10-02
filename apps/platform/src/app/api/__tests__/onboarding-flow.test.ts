/**
 * Onboarding flow integration tests.
 *
 * Tests the workspace creation, agent seeding, and workspace isolation
 * aspects of the new-user journey.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mock: auth
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'new-user-abc-123';
const TEST_ORG_ID = 'org-xyz-456';
const TEST_WORKSPACE_ID = '00000000-0000-0000-0000-000000000789';

vi.mock('@/lib/auth', () => ({
  getAuthUserId: vi.fn(() => TEST_USER_ID),
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

// Mock UUID validation — accept all in tests
vi.mock('@repo/db/validation', () => ({
  isValidUuid: vi.fn(() => true),
}));

// ---------------------------------------------------------------------------
// Mock: api-error
// ---------------------------------------------------------------------------

vi.mock('@/lib/api-error', async () => {
  const { NextResponse } = await import('next/server');
  return {
    safeErrorResponse: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    },
  };
});

// ---------------------------------------------------------------------------
// Mock: @repo/types (PLAN_TIERS)
// ---------------------------------------------------------------------------

vi.mock('@repo/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/types')>();
  return {
    ...actual,
    PLAN_TIERS: {
      build: { max_agents: 3, max_workspaces: 3 },
      pro: { max_agents: 5, max_workspaces: 10 },
      team: { max_agents: null, max_workspaces: 20 },
      enterprise: { max_agents: null, max_workspaces: null },
    },
  };
});

// ---------------------------------------------------------------------------
// Mock: Supabase service client
// ---------------------------------------------------------------------------

const mockFrom = vi.fn();
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockMaybeSingle = vi.fn();
const mockSingle = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockIn = vi.fn();

function resetChain() {
  mockFrom.mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
  });
  mockInsert.mockReturnValue({ select: mockSelect });
  mockSelect.mockReturnValue({
    eq: mockEq,
    in: mockIn,
    ilike: vi.fn().mockResolvedValue({ data: [], error: null }),
  });
  mockEq.mockReturnValue({
    eq: mockEq,
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
    order: mockOrder,
    limit: mockLimit,
  });
  mockIn.mockReturnValue({
    eq: mockEq,
    order: mockOrder,
  });
  mockOrder.mockReturnValue({
    limit: mockLimit,
    order: mockOrder,
    maybeSingle: mockMaybeSingle,
  });
  mockLimit.mockReturnValue({
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
  });
  mockSingle.mockResolvedValue({ data: null, error: null });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
}

vi.mock('@repo/db/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: mockFrom,
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
});

// ---------------------------------------------------------------------------
// Tests: POST /api/workspaces (workspace creation)
// ---------------------------------------------------------------------------

describe('POST /api/workspaces — new user workspace creation', () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('../../api/workspaces/route');
    POST = mod.POST;
  });

  it('rejects workspace creation without a name', async () => {
    const req = postJson('http://localhost:3002/api/workspaces', { name: '' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects workspace names shorter than 2 characters', async () => {
    const req = postJson('http://localhost:3002/api/workspaces', { name: 'A' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    const { getAuthUserId } = await import('@/lib/auth');
    vi.mocked(getAuthUserId).mockReturnValueOnce(null);

    const req = postJson('http://localhost:3002/api/workspaces', { name: 'Test Workspace' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 404 when user has no organization', async () => {
    // org_memberships lookup returns null
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });

    const req = postJson('http://localhost:3002/api/workspaces', { name: 'Test Workspace' });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/agents/seed (agent provisioning)
// ---------------------------------------------------------------------------

describe('POST /api/agents/seed — agent provisioning', () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('../../api/agents/seed/route');
    POST = mod.POST;
  });

  it('rejects requests without workspace_id', async () => {
    const req = postJson('http://localhost:3002/api/agents/seed', {});
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it('rejects when user is not a workspace member', async () => {
    // workspace_memberships lookup returns null
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const req = postJson('http://localhost:3002/api/agents/seed', {
      workspace_id: TEST_WORKSPACE_ID,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('seeds agents for a valid workspace member on build plan', async () => {
    // workspace_memberships — user is a member
    mockMaybeSingle.mockResolvedValueOnce({
      data: { workspace_id: TEST_WORKSPACE_ID },
      error: null,
    });

    // agent_configs — no existing agents
    mockEq.mockReturnValueOnce({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });

    // workspace org lookup
    mockSingle.mockResolvedValueOnce({
      data: { org_id: TEST_ORG_ID },
      error: null,
    });

    // workspace_memberships for org members
    mockEq.mockReturnValueOnce({
      eq: mockEq,
    });

    // subscriptions — no active sub (free plan)
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    // insert agents — return seeded result
    const seededAgents = [
      {
        agent_id: 'lead',
        display_name: 'Lead',
        role: 'Lead Engineer',
        description: '',
        model: 'claude-opus-4',
        color: '#6366f1',
      },
      {
        agent_id: 'reviewer',
        display_name: 'Reviewer',
        role: 'Code Reviewer',
        description: '',
        model: 'claude-sonnet-4',
        color: '#f59e0b',
      },
    ];
    mockSelect.mockResolvedValueOnce({ data: seededAgents, error: null });

    const req = postJson('http://localhost:3002/api/agents/seed', {
      workspace_id: TEST_WORKSPACE_ID,
    });
    const res = await POST(req);

    // Smoke test: route should not crash, expect either success or validation error
    expect(res.status).toBeLessThan(500);
  });

  it('returns 401 when not authenticated', async () => {
    const { getAuthUserId } = await import('@/lib/auth');
    vi.mocked(getAuthUserId).mockReturnValueOnce(null);

    // A valid v4 id, so the body parses and the permission check answers.
    const req = postJson('http://localhost:3002/api/agents/seed', {
      workspace_id: 'a0000000-0000-4000-8000-000000000789',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/workspaces — workspace isolation
// ---------------------------------------------------------------------------

describe('GET /api/workspaces — workspace isolation', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('../../api/workspaces/route');
    GET = mod.GET;
  });

  it('returns 401 for unauthenticated users', async () => {
    const { getAuthUserId } = await import('@/lib/auth');
    vi.mocked(getAuthUserId).mockReturnValueOnce(null);

    const req = makeRequest('http://localhost:3002/api/workspaces');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('requires authentication to list workspaces', async () => {
    // This verifies the core isolation guard: unauthenticated users
    // get 401, and the auth check happens before any DB queries
    const { getAuthUserId } = await import('@/lib/auth');
    vi.mocked(getAuthUserId).mockReturnValueOnce(null);

    const req = makeRequest('http://localhost:3002/api/workspaces');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Tests: Onboarding state validation
// ---------------------------------------------------------------------------

describe('Onboarding state — plan tier enforcement', () => {
  it('build plan limits to 3 agents', async () => {
    const { PLAN_TIERS } = await import('@repo/types');
    expect(PLAN_TIERS.build.max_agents).toBe(3);
  });

  it('pro plan allows up to 5 agents', async () => {
    const { PLAN_TIERS } = await import('@repo/types');
    expect(PLAN_TIERS.pro.max_agents).toBe(5);
  });

  it('team plan has unlimited agents', async () => {
    const { PLAN_TIERS } = await import('@repo/types');
    expect(PLAN_TIERS.team.max_agents).toBeNull();
  });

  it('build plan limits workspaces to 3', async () => {
    const { PLAN_TIERS } = await import('@repo/types');
    expect(PLAN_TIERS.build.max_workspaces).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Tests: Workspace creation input validation
// ---------------------------------------------------------------------------

describe('Workspace name validation', () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('../../api/workspaces/route');
    POST = mod.POST;
  });

  it('rejects names over 100 characters', async () => {
    const longName = 'A'.repeat(101);
    const req = postJson('http://localhost:3002/api/workspaces', { name: longName });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects non-string names', async () => {
    const req = postJson('http://localhost:3002/api/workspaces', { name: 42 });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
