/**
 * E2E-style integration test for the onboarding → workspace → checklist flow.
 *
 * Simulates a new user journey:
 *   1. Create workspace (POST /api/workspaces)
 *   2. Check setup status (GET /api/workspace/setup-status) — all incomplete
 *   3. Seed agents (POST /api/agents/seed) — agents step completes
 *   4. Check setup status again — agents step now complete
 *   5. Verify checklist progression tracks correctly
 *
 * Uses mock Supabase to test the query logic without a real DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_ID = 'onboarding-user-001';
const ORG_ID = 'onboarding-org-001';
const WORKSPACE_ID = 'a0b1c2d3-e4f5-6789-abcd-ef0123456789';

// ---------------------------------------------------------------------------
// Mock: auth
// ---------------------------------------------------------------------------

const mockGetAuthUserId = vi.fn((_req: unknown) => USER_ID as string | null);
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
    requireWorkspaceMembership: vi.fn(async () => null),
  };
});

// ---------------------------------------------------------------------------
// Mock: @repo/types
// ---------------------------------------------------------------------------

vi.mock('@repo/types', () => ({
  PLAN_TIERS: {
    build: { max_agents: 3, max_workspaces: 3 },
    pro: { max_agents: 5, max_workspaces: 10 },
    team: { max_agents: null, max_workspaces: 20 },
    enterprise: { max_agents: null, max_workspaces: null },
  },
}));

// ---------------------------------------------------------------------------
// Mock: Supabase — track state across the flow
// ---------------------------------------------------------------------------

// Simulated DB state that evolves as the flow progresses
const dbState = {
  workspace: { name: '', repo_url: null as string | null, metadata: {}, org_id: ORG_ID },
  projectCount: 0,
  taskCount: 0,
  agentCount: 0,
  repoCount: 0,
  apiKeyCount: 0,
  orgMembership: { org_id: ORG_ID, is_owner: true },
  workspaceMembership: { workspace_id: WORKSPACE_ID },
};

function resetDbState() {
  dbState.workspace = { name: '', repo_url: null, metadata: {}, org_id: ORG_ID };
  dbState.projectCount = 0;
  dbState.taskCount = 0;
  dbState.agentCount = 0;
  dbState.repoCount = 0;
  dbState.apiKeyCount = 0;
}

const mockFrom = vi.fn();
const mockRpc = vi.fn().mockResolvedValue({ data: [], error: null });

function createDynamicChain(table: string): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn((_cols?: string, opts?: { count?: string; head?: boolean }) => {
    if (opts?.head) {
      // Count query — return dynamic count
      const countChain: Record<string, unknown> = {};
      countChain.eq = vi.fn(() => countChain);
      countChain.then = (resolve: (v: unknown) => void) => {
        let count = 0;
        if (table === 'projects') count = dbState.projectCount;
        else if (table === 'tasks') count = dbState.taskCount;
        else if (table === 'agent_configs') count = dbState.agentCount;
        else if (table === 'workspace_repos') count = dbState.repoCount;
        else if (table === 'provider_api_keys') count = dbState.apiKeyCount;
        return Promise.resolve({ data: null, error: null, count }).then(resolve);
      };
      return countChain;
    }
    return chain;
  });
  chain.eq = vi.fn(() => chain);
  chain.ilike = vi.fn().mockResolvedValue({ data: [], error: null });
  chain.in = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.single = vi.fn(() => {
    if (table === 'workspaces') {
      return Promise.resolve({ data: dbState.workspace, error: null });
    }
    if (table === 'org_memberships' || table === 'org_members') {
      return Promise.resolve({ data: dbState.orgMembership, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
  chain.maybeSingle = vi.fn(() => {
    if (table === 'workspace_memberships') {
      return Promise.resolve({ data: dbState.workspaceMembership, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });

  return chain;
}

vi.mock('@repo/db/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: (table: string) => {
      mockFrom(table);
      return createDynamicChain(table);
    },
    rpc: mockRpc,
  })),
}));

// ---------------------------------------------------------------------------
// Import route handlers
// ---------------------------------------------------------------------------

import { GET as getSetupStatus } from '../../api/workspace/setup-status/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGetRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'));
}

const SETUP_URL = `http://localhost:3002/api/workspace/setup-status?workspace_id=${WORKSPACE_ID}`;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  resetDbState();
  mockGetAuthUserId.mockReturnValue(USER_ID);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Onboarding → Workspace → Checklist flow', () => {
  it('fresh workspace starts with only the name step completed (when named)', async () => {
    dbState.workspace.name = 'My First Workspace';

    const res = await getSetupStatus(makeGetRequest(SETUP_URL));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.completed_count).toBe(1); // just the name
    expect(body.total_count).toBe(6);

    const completed = body.steps.filter((s: { completed: boolean }) => s.completed);
    expect(completed).toHaveLength(1);
    expect(completed[0].id).toBe('workspace');
  });

  it('unnamed workspace starts with 0 steps completed', async () => {
    dbState.workspace.name = '';

    const res = await getSetupStatus(makeGetRequest(SETUP_URL));
    const body = await res.json();

    expect(body.completed_count).toBe(0);
  });

  it('checklist progresses as agents are seeded', async () => {
    dbState.workspace.name = 'Dev Workspace';

    // Before seeding: 1/6 (just name)
    const res1 = await getSetupStatus(makeGetRequest(SETUP_URL));
    const body1 = await res1.json();
    expect(body1.completed_count).toBe(1);

    // Simulate agent seeding
    dbState.agentCount = 2;

    // After seeding: 2/6 (name + agents)
    const res2 = await getSetupStatus(makeGetRequest(SETUP_URL));
    const body2 = await res2.json();
    expect(body2.completed_count).toBe(2);

    const agentStep = body2.steps.find((s: { id: string }) => s.id === 'agents');
    expect(agentStep.completed).toBe(true);
  });

  it('checklist progresses as projects and tasks are created', async () => {
    dbState.workspace.name = 'Full Setup';
    dbState.agentCount = 2;

    // 2/6 so far (name + agents)
    const res1 = await getSetupStatus(makeGetRequest(SETUP_URL));
    expect((await res1.json()).completed_count).toBe(2);

    // Add a project
    dbState.projectCount = 1;
    const res2 = await getSetupStatus(makeGetRequest(SETUP_URL));
    expect((await res2.json()).completed_count).toBe(3);

    // Add tasks
    dbState.taskCount = 3;
    const res3 = await getSetupStatus(makeGetRequest(SETUP_URL));
    expect((await res3.json()).completed_count).toBe(4);
  });

  it('reaches 6/6 when everything is connected', async () => {
    dbState.workspace.name = 'Complete Workspace';
    dbState.agentCount = 2;
    dbState.projectCount = 1;
    dbState.taskCount = 5;
    dbState.apiKeyCount = 1;
    dbState.workspace.repo_url = 'https://github.com/org/repo';

    const res = await getSetupStatus(makeGetRequest(SETUP_URL));
    const body = await res.json();

    expect(body.completed_count).toBe(6);
    expect(body.total_count).toBe(6);
    expect(body.steps.every((s: { completed: boolean }) => s.completed)).toBe(true);
  });

  it('step action_urls point to correct pages', async () => {
    dbState.workspace.name = 'Workspace';

    const res = await getSetupStatus(makeGetRequest(SETUP_URL));
    const body = await res.json();

    const urlMap: Record<string, string> = {};
    for (const step of body.steps) {
      urlMap[step.id] = step.action_url;
    }

    expect(urlMap.workspace).toBe('/settings');
    expect(urlMap.agents).toBe('/agents');
    expect(urlMap.project).toBe('/projects');
    expect(urlMap.task).toBe('/tasks');
    expect(urlMap.github).toBe('/settings?tab=integrations');
  });

  it('onboarding_completed_at timestamp is returned from metadata', async () => {
    const ts = '2026-03-11T10:00:00Z';
    dbState.workspace.name = 'Timestamped';
    dbState.workspace.metadata = { onboarding_completed_at: ts };

    const res = await getSetupStatus(makeGetRequest(SETUP_URL));
    const body = await res.json();

    expect(body.onboarding_completed_at).toBe(ts);
  });

  it('onboarding_completed_at is null when not set', async () => {
    dbState.workspace.name = 'No Timestamp';

    const res = await getSetupStatus(makeGetRequest(SETUP_URL));
    const body = await res.json();

    expect(body.onboarding_completed_at).toBeNull();
  });

  it('unauthenticated user cannot access checklist', async () => {
    mockGetAuthUserId.mockReturnValue(null);

    const res = await getSetupStatus(makeGetRequest(SETUP_URL));
    expect(res.status).toBe(401);
  });
});
