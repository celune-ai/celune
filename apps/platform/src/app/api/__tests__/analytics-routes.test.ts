import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

// Table-specific chain builder (same pattern as attachments-route tests)
function makeChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    gte: vi.fn(),
    lt: vi.fn(),
    not: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    single: vi.fn(),
  };
  for (const key of Object.keys(chain)) {
    (chain[key] as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  }
  Object.assign(chain, overrides);
  return chain;
}

type Chain = ReturnType<typeof makeChain>;

let tableChains: Record<string, Chain>;
const mockFrom = vi.fn((table: string) => tableChains[table] ?? makeChain());

// RPC mock for analytics RPCs (analytics_daily_completions, analytics_cost_sum, etc.)
let rpcResults: Record<string, unknown>;
const mockRpc = vi.fn((fn: string) => {
  const result = rpcResults[fn] ?? { data: null, error: null };
  return {
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      const r = result as { error?: unknown };
      if (r.error) return Promise.reject(r.error).then(resolve, reject);
      return Promise.resolve(result).then(resolve, reject);
    },
  };
});

vi.mock('@repo/db/server', () => ({
  createClient: vi.fn(async () => ({
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

// Mock UUID validation — accept all in tests
vi.mock('@repo/db/validation', () => ({
  isValidUuid: vi.fn(() => true),
}));

// Mock require-workspace — bypass auth/membership checks in unit tests by default.
// Individual tests can override via mockImplementationOnce to test auth rejection.
const { mockRequireWorkspaceScope } = vi.hoisted(() => ({
  mockRequireWorkspaceScope: vi.fn(),
}));

vi.mock('@/lib/require-workspace', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/require-workspace')>('@/lib/require-workspace');
  return {
    ...actual,
    requireWorkspaceScope: mockRequireWorkspaceScope,
  };
});

// Mock auth — return a user ID so dashboard can check platform owner
vi.mock('@/lib/auth', () => ({
  getAuthUserId: vi.fn(() => 'test-user-id'),
}));

// Mock service client for user_roles check in dashboard
const mockServiceFrom = vi.fn(() => ({
  select: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { role: 'owner' }, error: null }),
    }),
  }),
}));

vi.mock('@repo/db/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: mockServiceFrom,
  })),
}));

vi.mock('@/lib/api-cache', async () => {
  const { NextResponse } = await import('next/server');
  return {
    cachedJson: (data: unknown) => NextResponse.json(data),
  };
});

vi.mock('@/lib/api-error', async () => {
  const { NextResponse } = await import('next/server');
  return {
    safeErrorResponse: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    },
  };
});

// Dynamic imports — must be after vi.mock
import { GET as dashboardGET } from '../analytics/dashboard/route';
import { GET as utilizationGET } from '../analytics/utilization/route';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeDashboardRequest(): NextRequest {
  return new NextRequest(
    new URL('http://localhost:3002/api/analytics/dashboard?workspace_id=ws-test-123'),
  );
}

function makeUtilizationRequest(days?: number): NextRequest {
  const url = days
    ? `http://localhost:3002/api/analytics/utilization?workspace_id=ws-test-123&days=${days}`
    : 'http://localhost:3002/api/analytics/utilization?workspace_id=ws-test-123';
  return new NextRequest(new URL(url));
}

beforeEach(() => {
  vi.clearAllMocks();
  tableChains = {};
  rpcResults = {};
  // Default: bypass auth, return workspace scope directly
  mockRequireWorkspaceScope.mockImplementation(async (request: NextRequest) => {
    const wsId = request.nextUrl.searchParams.get('workspace_id');
    const wsIds = request.nextUrl.searchParams.get('workspace_ids');
    if (wsIds) return { workspace_ids: wsIds.split(',').filter(Boolean) };
    if (wsId) return { workspace_id: wsId };
    return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
  });
});

/* ================================================================== */
/*  /api/analytics/dashboard                                           */
/* ================================================================== */

describe('GET /api/analytics/dashboard', () => {
  /**
   * The dashboard route calls `.from()` on 4 tables (tasks, agent_status,
   * claude_usage, activity_log) across ~10 queries. We set up chains per
   * table and give them sensible defaults.
   */
  function setupDashboardMocks(
    overrides: {
      tasksError?: Error;
      agentStatuses?: Array<{ agent_name: string; status: string }>;
      totalCost?: number;
      errorActivities?: { errorCount: number; totalEvents: number };
      completedTasks?: Array<{
        claimed_at: string | null;
        updated_at: string;
      }>;
    } = {},
  ) {
    // --- tasks chain (called 3 times: q1 completedThisWeek, q2 completedLastWeek, q10 completedTasks) ---
    const tasksChain = makeChain();
    const tasksResults = [
      { count: 12 }, // q1: completedThisWeek
      { count: 8 }, // q2: completedLastWeek
      { data: overrides.completedTasks ?? [] }, // q10: completedTasks for avg time
    ];
    let tasksResolveIdx = 0;

    tasksChain.gte.mockImplementation(() => tasksChain);
    tasksChain.lt.mockImplementation(() => tasksChain);
    tasksChain.not.mockImplementation(() => tasksChain);
    tasksChain.eq.mockImplementation(() => tasksChain);
    tasksChain.in.mockImplementation(() => tasksChain);

    (tasksChain as Record<string, unknown>).then = (
      resolve: (v: unknown) => void,
      reject: (e: unknown) => void,
    ) => {
      const result = tasksResults[tasksResolveIdx++];
      if (overrides.tasksError && tasksResolveIdx === 1) {
        return Promise.reject(overrides.tasksError).then(resolve, reject);
      }
      return Promise.resolve(result).then(resolve, reject);
    };
    tableChains['tasks'] = tasksChain;

    // --- agent_status chain ---
    const agentChain = makeChain();
    const statuses = overrides.agentStatuses ?? [
      { agent_name: 'rick', status: 'working' },
      { agent_name: 'sage', status: 'online' },
      { agent_name: 'noir', status: 'offline' },
    ];
    (agentChain as Record<string, unknown>).then = (resolve: (v: unknown) => void) =>
      Promise.resolve({ data: statuses }).then(resolve);
    tableChains['agent_status'] = agentChain;

    // --- RPC mocks (replace old claude_usage chain) ---
    const today = new Date().toISOString().slice(0, 10);
    const costVal = overrides.totalCost ?? 5.5;
    rpcResults = {
      analytics_daily_completions: {
        data: [{ day: today, count: 3 }],
        error: null,
      },
      analytics_cost_sum: {
        data: [{ total_cost: costVal }],
        error: null,
      },
      analytics_daily_cost: {
        data: [{ day: today, total_cost: costVal }],
        error: null,
      },
    };
    // analytics_cost_sum is called twice (this week + last week) — track call count
    let costSumCallIdx = 0;
    const costSumResults = [
      { data: [{ total_cost: costVal }], error: null }, // this week
      { data: [{ total_cost: 0 }], error: null }, // last week
    ];
    mockRpc.mockImplementation((fn: string) => {
      let result;
      if (fn === 'analytics_cost_sum') {
        result = costSumResults[costSumCallIdx++] ?? costSumResults[0];
      } else {
        result = rpcResults[fn] ?? { data: null, error: null };
      }
      return {
        then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
          const r = result as { error?: unknown };
          if (r.error) return Promise.reject(r.error).then(resolve, reject);
          return Promise.resolve(result).then(resolve, reject);
        },
      };
    });

    // --- activity_log chain (2 queries: errorCount, totalEvents) ---
    const activityChain = makeChain();
    const errData = overrides.errorActivities ?? {
      errorCount: 2,
      totalEvents: 100,
    };
    const activityResults = [{ count: errData.errorCount }, { count: errData.totalEvents }];
    let actIdx = 0;
    (activityChain as Record<string, unknown>).then = (resolve: (v: unknown) => void) =>
      Promise.resolve(activityResults[actIdx++]).then(resolve);
    tableChains['activity_log'] = activityChain;
  }

  it('returns dashboard KPIs on happy path', async () => {
    setupDashboardMocks();
    const res = await dashboardGET(makeDashboardRequest());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.tasksCompleted).toBe(12);
    expect(data.tasksDelta).toBe(50); // (12-8)/8 * 100
    expect(data.activeAgents).toBe(2); // working + online
    expect(data.totalAgents).toBe(3);
    expect(data.totalCost).toBe(5.5);
    expect(data.errorRate).toBe(2); // 2/100 * 100 = 2.0%
    expect(data.errorCount).toBe(2);
    expect(data.totalEvents).toBe(100);
    expect(data.tasksSparkline).toHaveLength(7);
    expect(data.costSparkline).toHaveLength(7);
  });

  it('returns null tasksDelta when no tasks completed last week', async () => {
    setupDashboardMocks();
    // Override: completedLastWeek = 0
    const tasksResults = [
      { count: 5 }, // this week
      { count: 0 }, // last week → delta should be null
      { data: [] }, // completedTasks for avg time
    ];
    let idx = 0;
    (tableChains['tasks'] as Record<string, unknown>).then = (resolve: (v: unknown) => void) =>
      Promise.resolve(tasksResults[idx++]).then(resolve);

    const res = await dashboardGET(makeDashboardRequest());
    const data = await res.json();
    expect(data.tasksDelta).toBeNull();
  });

  it('computes avgCompletionHours from task metadata', async () => {
    const now = new Date();
    const claimedAt = new Date(now.getTime() - 10 * 60 * 60 * 1000).toISOString(); // 10 hours ago
    setupDashboardMocks({
      completedTasks: [
        {
          claimed_at: claimedAt,
          updated_at: now.toISOString(),
        },
      ],
    });

    const res = await dashboardGET(makeDashboardRequest());
    const data = await res.json();
    expect(data.avgCompletionHours).toBeCloseTo(10, 0);
  });

  it('returns 0 errorRate when no events', async () => {
    setupDashboardMocks({
      errorActivities: { errorCount: 0, totalEvents: 0 },
    });

    const res = await dashboardGET(makeDashboardRequest());
    const data = await res.json();
    expect(data.errorRate).toBe(0);
  });

  it('returns 500 on unexpected error', async () => {
    // Don't set up mocks — from() will return a default chain with no thenable
    // Instead, make createClient throw
    const { createClient } = await import('@repo/db/server');
    (createClient as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('DB connection failed'),
    );

    const res = await dashboardGET(makeDashboardRequest());
    expect(res.status).toBe(500);
  });
});

/* ================================================================== */
/*  /api/analytics/utilization                                         */
/* ================================================================== */

describe('GET /api/analytics/utilization', () => {
  function setupUtilizationMock(
    rows: Array<{ agent_id: string; created_at: string }> | null = null,
    error: Error | null = null,
  ) {
    const chain = makeChain();
    (chain as Record<string, unknown>).then = (
      resolve: (v: unknown) => void,
      reject: (e: unknown) => void,
    ) => {
      if (error) return Promise.reject(error).then(resolve, reject);
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    };
    tableChains['activity_log'] = chain;
  }

  it('returns agent utilization matrix', async () => {
    const monday = new Date('2026-03-02T12:00:00Z'); // Monday
    const wednesday = new Date('2026-03-04T12:00:00Z'); // Wednesday
    setupUtilizationMock([
      { agent_id: 'rick', created_at: monday.toISOString() },
      { agent_id: 'rick', created_at: monday.toISOString() },
      { agent_id: 'rick', created_at: wednesday.toISOString() },
      { agent_id: 'sage', created_at: wednesday.toISOString() },
    ]);

    const res = await utilizationGET(makeUtilizationRequest());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.days).toBe(30); // default
    expect(data.agents).toHaveLength(2);

    // Sorted alphabetically: rick, sage
    expect(data.agents[0].agent_id).toBe('rick');
    // Monday = index 0, Wednesday = index 2
    expect(data.agents[0].values[0]).toBe(2); // 2 Monday events
    expect(data.agents[0].values[2]).toBe(1); // 1 Wednesday event

    expect(data.agents[1].agent_id).toBe('sage');
    expect(data.agents[1].values[2]).toBe(1);
  });

  it('respects days query param (clamped 7-90)', async () => {
    setupUtilizationMock([]);

    // days=3 should be clamped to 7
    const res = await utilizationGET(makeUtilizationRequest(3));
    const data = await res.json();
    expect(data.days).toBe(7);
  });

  it('clamps days to max 90', async () => {
    setupUtilizationMock([]);

    const res = await utilizationGET(makeUtilizationRequest(200));
    const data = await res.json();
    expect(data.days).toBe(90);
  });

  it('returns empty agents array when no data', async () => {
    setupUtilizationMock([]);

    const res = await utilizationGET(makeUtilizationRequest());
    const data = await res.json();
    expect(data.agents).toEqual([]);
  });

  it('skips rows with null agent_id', async () => {
    setupUtilizationMock([
      { agent_id: 'rick', created_at: new Date().toISOString() },
      { agent_id: undefined as unknown as string, created_at: new Date().toISOString() },
    ]);

    const res = await utilizationGET(makeUtilizationRequest());
    const data = await res.json();
    expect(data.agents).toHaveLength(1);
    expect(data.agents[0].agent_id).toBe('rick');
  });

  it('returns 500 on database error', async () => {
    setupUtilizationMock(null, new Error('Query failed'));

    const res = await utilizationGET(makeUtilizationRequest());
    expect(res.status).toBe(500);
  });

  it('maps Sunday to index 6 (Mon=0 convention)', async () => {
    const sunday = new Date('2026-03-08T12:00:00Z'); // a Sunday
    setupUtilizationMock([{ agent_id: 'noir', created_at: sunday.toISOString() }]);

    const res = await utilizationGET(makeUtilizationRequest());
    const data = await res.json();
    expect(data.agents[0].values[6]).toBe(1); // Sunday = index 6
  });
});

/* ================================================================== */
/*  Unauthenticated request tests (Finding #6)                        */
/* ================================================================== */

describe('Unauthenticated requests return 401', () => {
  it('GET /api/analytics/dashboard returns 401 for unauthenticated user', async () => {
    mockRequireWorkspaceScope.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await dashboardGET(makeDashboardRequest());
    expect(res.status).toBe(401);
  });

  it('GET /api/analytics/utilization returns 401 for unauthenticated user', async () => {
    mockRequireWorkspaceScope.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await utilizationGET(makeUtilizationRequest());
    expect(res.status).toBe(401);
  });
});
