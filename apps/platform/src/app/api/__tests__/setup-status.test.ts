/**
 * Tests for GET /api/workspace/setup-status
 *
 * Validates the onboarding checklist endpoint: auth, membership,
 * step completion logic, progress tracking, and metadata handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'user-setup-abc-123';
const TEST_WORKSPACE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

// ---------------------------------------------------------------------------
// Mock: auth
// ---------------------------------------------------------------------------

const mockGetAuthUserId = vi.fn((_req: unknown) => TEST_USER_ID as string | null);
vi.mock('@/lib/auth', () => ({
  getAuthUserId: (req: unknown) => mockGetAuthUserId(req),
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
// Mock: require-workspace
// ---------------------------------------------------------------------------

const mockRequireWorkspaceMembership = vi.fn(
  async (_userId: string, _wsId: string) => null as Response | null,
);
vi.mock('@/lib/require-workspace', async () => {
  const { NextResponse } = await import('next/server');
  return {
    extractRequiredWorkspaceId: (request: NextRequest) => {
      const wsId = request.nextUrl.searchParams.get('workspace_id');
      if (!wsId) {
        return NextResponse.json(
          { error: 'workspace_id query parameter is required' },
          { status: 400 },
        );
      }
      return wsId;
    },
    requireWorkspaceMembership: (userId: string, wsId: string) =>
      mockRequireWorkspaceMembership(userId, wsId),
  };
});

// ---------------------------------------------------------------------------
// Mock: Supabase service client
// ---------------------------------------------------------------------------

type SupabaseResult = { data: unknown; error: unknown; count?: number | null };
const mockQueryResults = new Map<string, SupabaseResult>();

function makeChainable(table: string): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  const self = () => chain;

  chain.select = vi.fn((_cols?: string, _opts?: unknown) => {
    return chain;
  });
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(() => {
    const result = mockQueryResults.get(table);
    return Promise.resolve(result ?? { data: null, error: null });
  });

  // For count queries (head: true), resolve directly with count
  const originalSelect = chain.select as ReturnType<typeof vi.fn>;
  chain.select = vi.fn((_cols?: string, opts?: { count?: string; head?: boolean }) => {
    if (opts?.head) {
      // Return a thenable that resolves with count
      const countChain: Record<string, unknown> = {};
      countChain.eq = vi.fn(() => countChain);
      countChain.then = (resolve: (v: unknown) => void) => {
        const result = mockQueryResults.get(table);
        return Promise.resolve(result ?? { data: null, error: null, count: 0 }).then(resolve);
      };
      return countChain;
    }
    return chain;
  });

  return chain;
}

const mockFrom = vi.fn((table: string) => makeChainable(table));

vi.mock('@repo/db/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

// ---------------------------------------------------------------------------
// Import route handler
// ---------------------------------------------------------------------------

import { GET } from '../../api/workspace/setup-status/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'));
}

const BASE_URL = `http://localhost:3002/api/workspace/setup-status?workspace_id=${TEST_WORKSPACE_ID}`;

function setWorkspaceData(
  overrides: Partial<{
    name: string;
    repo_url: string | null;
    metadata: Record<string, unknown>;
    org_id: string;
  }> = {},
) {
  mockQueryResults.set('workspaces', {
    data: {
      name: overrides.name ?? 'Test Workspace',
      repo_url: overrides.repo_url ?? null,
      metadata: overrides.metadata ?? {},
      org_id: overrides.org_id ?? 'org-test-123',
    },
    error: null,
  });
}

function setCountResult(table: string, count: number) {
  mockQueryResults.set(table, { data: null, error: null, count });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockQueryResults.clear();
  mockGetAuthUserId.mockReturnValue(TEST_USER_ID);
  mockRequireWorkspaceMembership.mockResolvedValue(null);

  // Default: workspace exists with a name, no projects/tasks/agents/api-keys
  setWorkspaceData();
  setCountResult('projects', 0);
  setCountResult('tasks', 0);
  setCountResult('agent_configs', 0);
  setCountResult('provider_api_keys', 0);
});

describe('GET /api/workspace/setup-status', () => {
  // ----- Auth -----

  it('returns 401 without authentication', async () => {
    mockGetAuthUserId.mockReturnValue(null);

    const res = await GET(makeRequest(BASE_URL));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  // ----- Membership -----

  it('returns 403 for non-member', async () => {
    mockRequireWorkspaceMembership.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await GET(makeRequest(BASE_URL));
    expect(res.status).toBe(403);
  });

  // ----- Missing workspace_id -----

  it('returns 400 without workspace_id', async () => {
    const res = await GET(makeRequest('http://localhost:3002/api/workspace/setup-status'));
    expect(res.status).toBe(400);
  });

  // ----- Invalid workspace_id format -----

  it('returns 400 for invalid workspace_id format', async () => {
    const res = await GET(
      makeRequest('http://localhost:3002/api/workspace/setup-status?workspace_id=not-a-uuid'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid workspace_id format');
  });

  // ----- Returns 5 steps -----

  it('returns 6 setup steps with completion status', async () => {
    const res = await GET(makeRequest(BASE_URL));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.steps).toHaveLength(6);
    expect(body.total_count).toBe(6);

    const stepIds = body.steps.map((s: { id: string }) => s.id);
    expect(stepIds).toEqual(['workspace', 'api_keys', 'agents', 'project', 'task', 'github']);

    // Each step has required fields
    for (const step of body.steps) {
      expect(step).toHaveProperty('id');
      expect(step).toHaveProperty('title');
      expect(step).toHaveProperty('description');
      expect(step).toHaveProperty('completed');
      expect(step).toHaveProperty('action_url');
      expect(typeof step.completed).toBe('boolean');
    }
  });

  // ----- Project step -----

  it('marks project step completed when workspace has projects', async () => {
    setCountResult('projects', 3);

    const res = await GET(makeRequest(BASE_URL));
    const body = await res.json();

    const projectStep = body.steps.find((s: { id: string }) => s.id === 'project');
    expect(projectStep.completed).toBe(true);
  });

  it('marks project step incomplete when workspace has no projects', async () => {
    setCountResult('projects', 0);

    const res = await GET(makeRequest(BASE_URL));
    const body = await res.json();

    const projectStep = body.steps.find((s: { id: string }) => s.id === 'project');
    expect(projectStep.completed).toBe(false);
  });

  // ----- Agent step -----

  it('marks agent step completed when workspace has agent_configs', async () => {
    setCountResult('agent_configs', 2);

    const res = await GET(makeRequest(BASE_URL));
    const body = await res.json();

    const agentStep = body.steps.find((s: { id: string }) => s.id === 'agents');
    expect(agentStep.completed).toBe(true);
  });

  it('marks agent step incomplete when workspace has no agents', async () => {
    setCountResult('agent_configs', 0);

    const res = await GET(makeRequest(BASE_URL));
    const body = await res.json();

    const agentStep = body.steps.find((s: { id: string }) => s.id === 'agents');
    expect(agentStep.completed).toBe(false);
  });

  // ----- GitHub step -----

  it('marks github step completed when workspace.repo_url is set', async () => {
    setWorkspaceData({ repo_url: 'https://github.com/org/repo' });

    const res = await GET(makeRequest(BASE_URL));
    const body = await res.json();

    const githubStep = body.steps.find((s: { id: string }) => s.id === 'github');
    expect(githubStep.completed).toBe(true);
  });

  it('marks github step incomplete when workspace.repo_url is null', async () => {
    setWorkspaceData({ repo_url: null });

    const res = await GET(makeRequest(BASE_URL));
    const body = await res.json();

    const githubStep = body.steps.find((s: { id: string }) => s.id === 'github');
    expect(githubStep.completed).toBe(false);
  });

  // ----- Progress tracking -----

  it('completed_count matches actual completed steps', async () => {
    // workspace name: completed (always, since we set a name)
    // agents: completed
    // projects: completed
    // tasks: incomplete
    // github: incomplete
    setCountResult('agent_configs', 1);
    setCountResult('projects', 2);
    setCountResult('tasks', 0);
    setWorkspaceData({ repo_url: null });

    const res = await GET(makeRequest(BASE_URL));
    const body = await res.json();

    const actualCompleted = body.steps.filter((s: { completed: boolean }) => s.completed).length;
    expect(body.completed_count).toBe(actualCompleted);
    expect(body.completed_count).toBe(3); // workspace + agents + project (api_keys not set)
  });

  it('completed_count is 0 when nothing is set up', async () => {
    setWorkspaceData({ name: '', repo_url: null }); // empty name = incomplete
    setCountResult('projects', 0);
    setCountResult('tasks', 0);
    setCountResult('agent_configs', 0);

    const res = await GET(makeRequest(BASE_URL));
    const body = await res.json();

    expect(body.completed_count).toBe(0);
  });

  it('completed_count is 6 when everything is set up', async () => {
    setWorkspaceData({ name: 'My Workspace', repo_url: 'https://github.com/org/repo' });
    setCountResult('projects', 1);
    setCountResult('tasks', 5);
    setCountResult('agent_configs', 2);
    setCountResult('provider_api_keys', 1);

    const res = await GET(makeRequest(BASE_URL));
    const body = await res.json();

    expect(body.completed_count).toBe(6);
    expect(body.total_count).toBe(6);
  });

  // ----- Onboarding timestamp -----

  it('returns onboarding_completed_at from workspace metadata', async () => {
    const timestamp = '2026-03-01T12:00:00Z';
    setWorkspaceData({ metadata: { onboarding_completed_at: timestamp } });

    const res = await GET(makeRequest(BASE_URL));
    const body = await res.json();

    expect(body.onboarding_completed_at).toBe(timestamp);
  });

  it('returns null onboarding_completed_at when not set in metadata', async () => {
    setWorkspaceData({ metadata: {} });

    const res = await GET(makeRequest(BASE_URL));
    const body = await res.json();

    expect(body.onboarding_completed_at).toBeNull();
  });

  it('returns null onboarding_completed_at when metadata has non-string value', async () => {
    setWorkspaceData({ metadata: { onboarding_completed_at: 12345 } });

    const res = await GET(makeRequest(BASE_URL));
    const body = await res.json();

    expect(body.onboarding_completed_at).toBeNull();
  });
});
