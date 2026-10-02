import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ---------- Mock setup ----------

const mockFrom = vi.fn();

vi.mock('@repo/db/service', () => ({
  createServiceClient: () => ({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock('@/lib/api-error', async () => {
  const { NextResponse: NR } = await import('next/server');
  return {
    safeErrorResponse: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NR.json({ error: msg }, { status: 500 });
    },
  };
});

vi.mock('@/lib/csrf', () => ({
  validateOrigin: () => null,
}));

vi.mock('@/lib/rate-limiter', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_WRITE: {},
}));

const mockGetAuthUserId = vi.fn();
vi.mock('@/lib/auth', () => ({
  getAuthUserId: (...args: unknown[]) => mockGetAuthUserId(...args),
}));

// Mock requireOrgStaff — configurable per test
const mockRequireOrgStaff = vi.fn();
vi.mock('@/app/api/org/agents/require-org-staff', () => ({
  requireOrgStaff: (...args: unknown[]) => mockRequireOrgStaff(...args),
}));

// Also alias the relative import used by shared/[id]/route.ts
vi.mock('../../require-org-staff', () => ({
  requireOrgStaff: (...args: unknown[]) => mockRequireOrgStaff(...args),
}));

// Also alias the relative import used by shared/route.ts
vi.mock('../require-org-staff', () => ({
  requireOrgStaff: (...args: unknown[]) => mockRequireOrgStaff(...args),
}));

// Import after mocks
import { GET, POST } from '@/app/api/org/agents/shared/route';
import { PUT, DELETE } from '@/app/api/org/agents/shared/[id]/route';

type RouteHandler = (
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;

const typedPUT = PUT as RouteHandler;
const typedDELETE = DELETE as RouteHandler;

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'), init as never);
}

// ---------- Helpers for Supabase mock chains ----------

function mockChain(result: { data?: unknown; error?: unknown; count?: number }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const terminal = vi.fn(async () => result);
  chain.select = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn(async () => result);
  chain.single = terminal;
  chain.maybeSingle = terminal;
  return chain;
}

// ---------- Tests ----------

describe('GET /api/org/agents/shared', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockGetAuthUserId.mockReturnValue(null);

    const req = makeRequest('http://localhost:3002/api/org/agents/shared');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 404 when user has no org membership', async () => {
    mockGetAuthUserId.mockReturnValue('user-1');

    const membershipChain = mockChain({ data: null, error: null });
    mockFrom.mockReturnValue(membershipChain);

    const req = makeRequest('http://localhost:3002/api/org/agents/shared');
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it('returns shared agents list for org member', async () => {
    mockGetAuthUserId.mockReturnValue('user-1');

    const agents = [
      { id: 'a1', agent_id: 'strategist', display_name: 'Strategist' },
      { id: 'a2', agent_id: 'analyst', display_name: 'Analyst' },
    ];

    // First call: org_memberships lookup
    const membershipChain = mockChain({ data: { org_id: 'org-1' }, error: null });
    // Second call: org_shared_agents list
    const agentsChain = mockChain({ data: agents, error: null });

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === 'org_memberships') return membershipChain;
      if (table === 'org_shared_agents') return agentsChain;
      return membershipChain;
    });

    const req = makeRequest('http://localhost:3002/api/org/agents/shared');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0].agent_id).toBe('strategist');
  });
});

describe('POST /api/org/agents/shared', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when user is not org staff', async () => {
    mockRequireOrgStaff.mockResolvedValue(null);

    const req = makeRequest('http://localhost:3002/api/org/agents/shared', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: 'test-agent',
        display_name: 'Test Agent',
      }),
    });

    // withApiSecurity extracts userId and body; we need to call POST directly
    // The withApiSecurity wrapper calls requireOrgStaff with userId
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('creates shared agent when authorized', async () => {
    mockRequireOrgStaff.mockResolvedValue('org-1');

    const created = {
      id: 'new-id',
      org_id: 'org-1',
      agent_id: 'test-agent',
      display_name: 'Test Agent',
    };

    // First call: check duplicate
    const duplicateChain = mockChain({ data: null, error: null });
    // Second call: insert
    const insertChain = mockChain({ data: created, error: null });

    mockFrom.mockImplementation(() => {
      // The first from('org_shared_agents') is the duplicate check (select → eq → eq → single)
      // The second is the insert
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn(async () => ({ data: null, error: null })),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn(async () => ({ data: created, error: null })),
          }),
        }),
      };
    });

    const req = makeRequest('http://localhost:3002/api/org/agents/shared', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: 'test-agent',
        display_name: 'Test Agent',
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.agent_id).toBe('test-agent');
  });

  it('returns 409 when agent_id already exists in org', async () => {
    mockRequireOrgStaff.mockResolvedValue('org-1');

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn(async () => ({ data: { id: 'existing' }, error: null })),
          }),
        }),
      }),
      insert: vi.fn(),
    });

    const req = makeRequest('http://localhost:3002/api/org/agents/shared', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: 'existing-agent',
        display_name: 'Duplicate',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
  });
});

describe('PUT /api/org/agents/shared/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when user is not org staff', async () => {
    mockRequireOrgStaff.mockResolvedValue(null);

    const req = makeRequest('http://localhost:3002/api/org/agents/shared/agent-row-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: 'Updated Name' }),
    });

    const res = await typedPUT(req, { params: Promise.resolve({ id: 'agent-row-1' }) });
    expect(res.status).toBe(403);
  });

  it('updates shared agent when authorized', async () => {
    mockRequireOrgStaff.mockResolvedValue('org-1');

    const updated = {
      id: 'agent-row-1',
      org_id: 'org-1',
      display_name: 'Updated Name',
    };

    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn(async () => ({ data: updated, error: null })),
            }),
          }),
        }),
      }),
    });

    const req = makeRequest('http://localhost:3002/api/org/agents/shared/agent-row-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: 'Updated Name' }),
    });

    const res = await typedPUT(req, { params: Promise.resolve({ id: 'agent-row-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.display_name).toBe('Updated Name');
  });

  it('returns 400 when no fields to update', async () => {
    mockRequireOrgStaff.mockResolvedValue('org-1');

    const req = makeRequest('http://localhost:3002/api/org/agents/shared/agent-row-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await typedPUT(req, { params: Promise.resolve({ id: 'agent-row-1' }) });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/org/agents/shared/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockGetAuthUserId.mockReturnValue(null);

    const req = makeRequest('http://localhost:3002/api/org/agents/shared/agent-row-1', {
      method: 'DELETE',
    });

    const res = await typedDELETE(req, { params: Promise.resolve({ id: 'agent-row-1' }) });
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not org staff', async () => {
    mockGetAuthUserId.mockReturnValue('user-1');
    mockRequireOrgStaff.mockResolvedValue(null);

    const req = makeRequest('http://localhost:3002/api/org/agents/shared/agent-row-1', {
      method: 'DELETE',
    });

    const res = await typedDELETE(req, { params: Promise.resolve({ id: 'agent-row-1' }) });
    expect(res.status).toBe(403);
  });

  it('deletes shared agent when authorized', async () => {
    mockGetAuthUserId.mockReturnValue('user-1');
    mockRequireOrgStaff.mockResolvedValue('org-1');

    mockFrom.mockReturnValue({
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn(async () => ({ error: null })),
        }),
      }),
    });

    const req = makeRequest('http://localhost:3002/api/org/agents/shared/agent-row-1', {
      method: 'DELETE',
    });

    const res = await typedDELETE(req, { params: Promise.resolve({ id: 'agent-row-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deleted).toBe(true);
  });
});
