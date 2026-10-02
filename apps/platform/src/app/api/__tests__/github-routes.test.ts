/**
 * Tests for GitHub installation and detect-installation API routes.
 *
 * Covers:
 *   GET  /api/github/installations     — org resolution, installation verification
 *   DELETE /api/github/installations   — CSRF, rate limit, membership, clearing installation_id
 *   GET  /api/github/detect-installation — auth, ownership, DB lookup, GitHub API fallback
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'gh-user-001';
const TEST_ORG_ID = 'gh-org-001';
const TEST_WORKSPACE_ID = '00000000-0000-0000-0000-000000002222';
const TEST_INSTALLATION_ID = 42;

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

const mockValidateOrigin = vi.fn(async (_req?: unknown) => null as Response | null);

vi.mock('@/lib/csrf', () => ({
  validateOrigin: (req: unknown) => mockValidateOrigin(req),
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
  RATE_READ: { limit: 120, windowMs: 60000 },
}));

// ---------------------------------------------------------------------------
// Mock: require-workspace
// ---------------------------------------------------------------------------

const mockRequireWorkspaceMembership = vi.fn(
  async (_userId?: unknown, _wsId?: unknown) => null as Response | null,
);

vi.mock('@/lib/require-workspace', () => ({
  requireWorkspaceMembership: (userId: unknown, wsId: unknown) =>
    mockRequireWorkspaceMembership(userId, wsId),
}));

// ---------------------------------------------------------------------------
// Mock: @repo/db/validation
// ---------------------------------------------------------------------------

vi.mock('@repo/db/validation', () => ({
  isValidUuid: (val: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val),
}));

// ---------------------------------------------------------------------------
// Mock: github-app
// ---------------------------------------------------------------------------

const mockCreateInstallationOctokit = vi.fn();
const mockIsGitHubAppConfigured = vi.fn(() => true);
const mockCreateAppOctokit = vi.fn();

vi.mock('@/lib/github-app', () => ({
  createInstallationOctokit: (id: unknown) => mockCreateInstallationOctokit(id),
  isGitHubAppConfigured: () => mockIsGitHubAppConfigured(),
  createAppOctokit: () => mockCreateAppOctokit(),
}));

// ---------------------------------------------------------------------------
// Mock: github-org
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetOrgInstallations = vi.fn(async (..._args: any[]) => [] as any[]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRegisterOrgInstallation = vi.fn(async (..._args: any[]) => null as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOrgHasAnyInstallation = vi.fn(async (..._args: any[]) => false);

vi.mock('@/lib/github-org', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getOrgInstallations: (...args: any[]) => mockGetOrgInstallations(...args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerOrgInstallation: (...args: any[]) => mockRegisterOrgInstallation(...args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  orgHasAnyInstallation: (...args: any[]) => mockOrgHasAnyInstallation(...args),
}));

// ---------------------------------------------------------------------------
// Mock: Supabase
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFromHandlers: Record<string, (...args: any[]) => any> = {};

function createTableChain(
  resolvedValue: { data: unknown; error: unknown } = { data: null, error: null },
) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const self = () => chain;
  chain.select = vi.fn().mockImplementation(self);
  chain.eq = vi.fn().mockImplementation(self);
  chain.neq = vi.fn().mockImplementation(self);
  chain.in = vi.fn().mockImplementation(self);
  chain.is = vi.fn().mockImplementation(self);
  chain.limit = vi.fn().mockImplementation(self);
  chain.order = vi.fn().mockImplementation(self);
  chain.single = vi.fn().mockResolvedValue(resolvedValue);
  chain.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  chain.insert = vi.fn().mockImplementation(self);
  chain.update = vi.fn().mockImplementation(self);
  chain.upsert = vi.fn().mockImplementation(self);
  chain.delete = vi.fn().mockImplementation(self);
  // Allow chain.data and chain.error access for non-awaited results
  Object.defineProperty(chain, 'data', { get: () => resolvedValue.data, configurable: true });
  Object.defineProperty(chain, 'error', { get: () => resolvedValue.error, configurable: true });
  return chain;
}

const defaultTableChain = createTableChain();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFrom = vi.fn((table: string): any => {
  if (mockFromHandlers[table]) {
    return mockFromHandlers[table]();
  }
  return defaultTableChain;
});

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

function makeDeleteRequest(url: string, body: Record<string, unknown>): NextRequest {
  return makeRequest(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': TEST_USER_ID,
      origin: 'http://localhost:3002',
    },
    body: JSON.stringify(body),
  });
}

function setTableHandler(table: string, factory: () => ReturnType<typeof createTableChain>) {
  mockFromHandlers[table] = factory;
}

function clearTableHandlers() {
  for (const key of Object.keys(mockFromHandlers)) {
    delete mockFromHandlers[key];
  }
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  clearTableHandlers();
  mockGetAuthUserId.mockReturnValue(TEST_USER_ID);
  mockValidateOrigin.mockResolvedValue(null);
  mockRequireWorkspaceMembership.mockResolvedValue(null);
  mockIsGitHubAppConfigured.mockReturnValue(true);
  mockGetOrgInstallations.mockResolvedValue([]);
  mockOrgHasAnyInstallation.mockResolvedValue(false);
});

// ===========================================================================
// GET /api/github/installations
// ===========================================================================

describe('GET /api/github/installations', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('../../api/github/installations/route');
    GET = mod.GET;
  });

  it('returns 401 when user is not authenticated', async () => {
    mockGetAuthUserId.mockReturnValue(null);
    const req = makeRequest('http://localhost:3002/api/github/installations');
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/authentication/i);
  });

  it('returns 404 when user has no organization via any path', async () => {
    // org_members query returns null
    setTableHandler('org_members', () => {
      const chain = createTableChain({ data: null, error: null });
      return chain;
    });
    // workspace_memberships returns null
    setTableHandler('workspace_memberships', () => {
      const chain = createTableChain({ data: null, error: null });
      return chain;
    });

    const req = makeRequest('http://localhost:3002/api/github/installations');
    const res = await GET(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/organization not found/i);
  });

  it('returns installations when org is found via org_members', async () => {
    setTableHandler('org_members', () => {
      const chain = createTableChain({ data: { org_id: TEST_ORG_ID }, error: null });
      return chain;
    });

    const mockInstallation = {
      installation_id: TEST_INSTALLATION_ID,
      github_account_login: 'test-org',
      github_account_avatar_url: 'https://example.com/avatar.png',
    };
    mockGetOrgInstallations.mockResolvedValue([mockInstallation]);

    // GitHub API verification
    mockCreateInstallationOctokit.mockResolvedValue({
      rest: {
        apps: {
          getInstallation: vi.fn().mockResolvedValue({ data: {} }),
        },
      },
    });

    const req = makeRequest('http://localhost:3002/api/github/installations');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.installations).toHaveLength(1);
    expect(body.installations[0].installation_id).toBe(TEST_INSTALLATION_ID);
    expect(body.had_installation).toBe(true);
  });

  it('returns empty installations when none exist', async () => {
    setTableHandler('org_members', () => {
      return createTableChain({ data: { org_id: TEST_ORG_ID }, error: null });
    });
    mockGetOrgInstallations.mockResolvedValue([]);

    const req = makeRequest('http://localhost:3002/api/github/installations');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.installations).toEqual([]);
    expect(body.had_installation).toBe(false);
  });

  it('reports had_installation when the org only has inactive installations', async () => {
    setTableHandler('org_members', () => {
      return createTableChain({ data: { org_id: TEST_ORG_ID }, error: null });
    });
    mockGetOrgInstallations.mockResolvedValue([]);
    mockOrgHasAnyInstallation.mockResolvedValue(true);

    const req = makeRequest('http://localhost:3002/api/github/installations');
    const res = await GET(req);
    const body = await res.json();
    expect(body.installations).toEqual([]);
    expect(body.had_installation).toBe(true);
    expect(mockOrgHasAnyInstallation).toHaveBeenCalledWith(expect.anything(), TEST_ORG_ID);
  });

  it('deactivates installations that no longer exist on GitHub', async () => {
    setTableHandler('org_members', () => {
      return createTableChain({ data: { org_id: TEST_ORG_ID }, error: null });
    });

    const staleInstallation = {
      installation_id: 99,
      github_account_login: 'stale-org',
      github_account_avatar_url: null,
    };
    mockGetOrgInstallations.mockResolvedValue([staleInstallation]);

    // GitHub API throws 404 (installation removed)
    const notFoundError = Object.assign(new Error('Not Found'), { status: 404 });
    mockCreateInstallationOctokit.mockResolvedValue({
      rest: {
        apps: {
          getInstallation: vi.fn().mockRejectedValue(notFoundError),
        },
      },
    });

    // org_github_installations and workspaces need update chains
    setTableHandler('org_github_installations', () => {
      return createTableChain({ data: null, error: null });
    });
    setTableHandler('workspaces', () => {
      return createTableChain({ data: null, error: null });
    });

    const req = makeRequest('http://localhost:3002/api/github/installations');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Stale installation should be filtered out
    expect(body.installations).toEqual([]);
    expect(body.had_installation).toBe(true);
  });
});

// ===========================================================================
// DELETE /api/github/installations
// ===========================================================================

describe('DELETE /api/github/installations', () => {
  let DELETE: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('../../api/github/installations/route');
    DELETE = mod.DELETE;
  });

  it('returns CSRF error when origin validation fails', async () => {
    const { NextResponse: NR } = await import('next/server');
    mockValidateOrigin.mockResolvedValue(
      NR.json({ error: 'Invalid origin' }, { status: 403 }) as unknown as Response,
    );

    const req = makeDeleteRequest('http://localhost:3002/api/github/installations', {
      workspace_id: TEST_WORKSPACE_ID,
    });
    const res = await DELETE(req);
    expect(res.status).toBe(403);
  });

  it('returns 401 when user is not authenticated', async () => {
    mockGetAuthUserId.mockReturnValue(null);
    const req = makeDeleteRequest('http://localhost:3002/api/github/installations', {
      workspace_id: TEST_WORKSPACE_ID,
    });
    const res = await DELETE(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 when workspace_id is missing', async () => {
    const req = makeDeleteRequest('http://localhost:3002/api/github/installations', {});
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when workspace_id is not a valid UUID', async () => {
    const req = makeDeleteRequest('http://localhost:3002/api/github/installations', {
      workspace_id: 'not-a-uuid',
    });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it('returns 403 when user is not a workspace member', async () => {
    const { NextResponse: NR } = await import('next/server');
    mockRequireWorkspaceMembership.mockResolvedValue(
      NR.json({ error: 'Forbidden' }, { status: 403 }) as unknown as Response,
    );

    const req = makeDeleteRequest('http://localhost:3002/api/github/installations', {
      workspace_id: TEST_WORKSPACE_ID,
    });
    const res = await DELETE(req);
    expect(res.status).toBe(403);
  });

  it('clears installation_id and returns ok on success', async () => {
    setTableHandler('workspaces', () => {
      const chain = createTableChain({ data: null, error: null });
      return chain;
    });

    const req = makeDeleteRequest('http://localhost:3002/api/github/installations', {
      workspace_id: TEST_WORKSPACE_ID,
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ===========================================================================
// GET /api/github/detect-installation
// ===========================================================================

describe('GET /api/github/detect-installation', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('../../api/github/detect-installation/route');
    GET = mod.GET;
  });

  it('returns 401 when user is not authenticated', async () => {
    mockGetAuthUserId.mockReturnValue(null);
    const req = makeRequest(
      `http://localhost:3002/api/github/detect-installation?workspace_id=${TEST_WORKSPACE_ID}`,
    );
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 when workspace_id is missing', async () => {
    const req = makeRequest('http://localhost:3002/api/github/detect-installation');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/workspace_id/i);
  });

  it('returns 400 when workspace_id is not a valid UUID', async () => {
    const req = makeRequest(
      'http://localhost:3002/api/github/detect-installation?workspace_id=bad-id',
    );
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns found:false when GitHub app is not configured', async () => {
    mockIsGitHubAppConfigured.mockReturnValue(false);
    const req = makeRequest(
      `http://localhost:3002/api/github/detect-installation?workspace_id=${TEST_WORKSPACE_ID}`,
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(false);
    expect(body.reason).toBe('github_app_not_configured');
  });

  it('returns 404 when workspace does not exist', async () => {
    setTableHandler('workspaces', () => {
      return createTableChain({ data: null, error: null });
    });

    const req = makeRequest(
      `http://localhost:3002/api/github/detect-installation?workspace_id=${TEST_WORKSPACE_ID}`,
    );
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it('returns 403 when user has no access to the workspace', async () => {
    // workspace exists
    setTableHandler('workspaces', () => {
      return createTableChain({
        data: { id: TEST_WORKSPACE_ID, org_id: TEST_ORG_ID, github_installation_id: null },
        error: null,
      });
    });
    // org owner check fails
    setTableHandler('organizations', () => {
      return createTableChain({
        data: { owner_id: 'someone-else' },
        error: null,
      });
    });
    // org_memberships check fails
    setTableHandler('org_memberships', () => {
      return createTableChain({ data: null, error: null });
    });
    // workspace_memberships check fails
    setTableHandler('workspace_memberships', () => {
      return createTableChain({ data: null, error: null });
    });

    const req = makeRequest(
      `http://localhost:3002/api/github/detect-installation?workspace_id=${TEST_WORKSPACE_ID}`,
    );
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('returns existing installation when workspace already has one', async () => {
    setTableHandler('workspaces', () => {
      return createTableChain({
        data: {
          id: TEST_WORKSPACE_ID,
          org_id: TEST_ORG_ID,
          github_installation_id: TEST_INSTALLATION_ID,
        },
        error: null,
      });
    });
    // org owner check passes
    setTableHandler('organizations', () => {
      return createTableChain({
        data: { owner_id: TEST_USER_ID },
        error: null,
      });
    });
    // DB lookup for the installation
    setTableHandler('org_github_installations', () => {
      return createTableChain({
        data: {
          installation_id: TEST_INSTALLATION_ID,
          github_account_login: 'my-org',
          github_account_avatar_url: 'https://example.com/avatar.png',
        },
        error: null,
      });
    });

    const req = makeRequest(
      `http://localhost:3002/api/github/detect-installation?workspace_id=${TEST_WORKSPACE_ID}`,
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.installation_id).toBe(TEST_INSTALLATION_ID);
    expect(body.account_login).toBe('my-org');
  });

  it('returns found:false with reason when GitHub API returns no installations', async () => {
    setTableHandler('workspaces', () => {
      return createTableChain({
        data: { id: TEST_WORKSPACE_ID, org_id: TEST_ORG_ID, github_installation_id: null },
        error: null,
      });
    });
    setTableHandler('organizations', () => {
      return createTableChain({
        data: { owner_id: TEST_USER_ID },
        error: null,
      });
    });
    // No existing org installations in DB
    setTableHandler('org_github_installations', () => {
      const chain = createTableChain({ data: null, error: null });
      // Override limit to return array-like result (no installations)
      chain.limit = vi.fn().mockResolvedValue({ data: [], error: null });
      return chain;
    });

    // GitHub API returns empty
    mockCreateAppOctokit.mockReturnValue({
      rest: {
        apps: {
          listInstallations: vi.fn().mockResolvedValue({ data: [] }),
        },
      },
    });

    const req = makeRequest(
      `http://localhost:3002/api/github/detect-installation?workspace_id=${TEST_WORKSPACE_ID}`,
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(false);
    expect(body.reason).toBe('no_installations');
  });

  it('returns no_installations when no inactive records exist for org', async () => {
    setTableHandler('workspaces', () => {
      return createTableChain({
        data: { id: TEST_WORKSPACE_ID, org_id: TEST_ORG_ID, github_installation_id: null },
        error: null,
      });
    });
    setTableHandler('organizations', () => {
      return createTableChain({
        data: { owner_id: TEST_USER_ID },
        error: null,
      });
    });
    setTableHandler('org_github_installations', () => {
      const chain = createTableChain({ data: null, error: null });
      chain.limit = vi.fn().mockResolvedValue({ data: [], error: null });
      // Also mock the inactive query (is_active=false) returning empty
      chain.order = vi.fn().mockResolvedValue({ data: [], error: null });
      return chain;
    });

    const req = makeRequest(
      `http://localhost:3002/api/github/detect-installation?workspace_id=${TEST_WORKSPACE_ID}`,
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(false);
    expect(body.reason).toBe('no_installations');
  });

  it('allows access via org_memberships when user is not org owner', async () => {
    setTableHandler('workspaces', () => {
      return createTableChain({
        data: {
          id: TEST_WORKSPACE_ID,
          org_id: TEST_ORG_ID,
          github_installation_id: TEST_INSTALLATION_ID,
        },
        error: null,
      });
    });
    // Not org owner
    setTableHandler('organizations', () => {
      return createTableChain({
        data: { owner_id: 'another-user' },
        error: null,
      });
    });
    // But has org_memberships record
    setTableHandler('org_memberships', () => {
      return createTableChain({
        data: { role: 'member' },
        error: null,
      });
    });
    setTableHandler('org_github_installations', () => {
      return createTableChain({
        data: {
          installation_id: TEST_INSTALLATION_ID,
          github_account_login: 'team-org',
          github_account_avatar_url: null,
        },
        error: null,
      });
    });

    const req = makeRequest(
      `http://localhost:3002/api/github/detect-installation?workspace_id=${TEST_WORKSPACE_ID}`,
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.account_login).toBe('team-org');
  });

  it('allows access via workspace_memberships as last resort', async () => {
    setTableHandler('workspaces', () => {
      return createTableChain({
        data: {
          id: TEST_WORKSPACE_ID,
          org_id: TEST_ORG_ID,
          github_installation_id: TEST_INSTALLATION_ID,
        },
        error: null,
      });
    });
    setTableHandler('organizations', () => {
      return createTableChain({
        data: { owner_id: 'another-user' },
        error: null,
      });
    });
    // No org_memberships
    setTableHandler('org_memberships', () => {
      return createTableChain({ data: null, error: null });
    });
    // But has workspace_memberships
    setTableHandler('workspace_memberships', () => {
      return createTableChain({
        data: { id: 'wm-1' },
        error: null,
      });
    });
    setTableHandler('org_github_installations', () => {
      return createTableChain({
        data: {
          installation_id: TEST_INSTALLATION_ID,
          github_account_login: 'ws-org',
          github_account_avatar_url: null,
        },
        error: null,
      });
    });

    const req = makeRequest(
      `http://localhost:3002/api/github/detect-installation?workspace_id=${TEST_WORKSPACE_ID}`,
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
  });
});
