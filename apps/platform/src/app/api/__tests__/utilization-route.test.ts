import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  getAuthUserId: vi.fn(() => 'test-user-id'),
}));

vi.mock('@/lib/require-workspace', () => ({
  extractWorkspaceScope: (request: { nextUrl: { searchParams: URLSearchParams } }) => {
    const wsId = request.nextUrl.searchParams.get('workspace_id');
    if (wsId) return { workspace_id: wsId };
    const { NextResponse } = require('next/server');
    return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
  },
  requireWorkspaceMembership: vi.fn(async () => null),
}));

const mockFrom = vi.fn();
vi.mock('@repo/db/server', () => ({
  createClient: vi.fn(async () => ({ from: mockFrom })),
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

vi.mock('@/lib/api-cache', () => ({
  cachedJson: (data: unknown) => {
    const { NextResponse } = require('next/server');
    return NextResponse.json(data);
  },
}));

import { GET } from '../analytics/agents/utilization/route';

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'));
}

/** Creates a chainable Supabase query mock that resolves to { data, error }. */
function mockChain(data: unknown[], error: unknown = null) {
  const result = { data, error };
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.in = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.not = vi.fn(self);
  chain.gte = vi.fn(self);
  // Make it thenable so `await query` resolves
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/analytics/agents/utilization', () => {
  it('returns 400 without workspace_id', async () => {
    const req = makeRequest('http://localhost:3002/api/analytics/agents/utilization');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const { getAuthUserId } = await import('@/lib/auth');
    vi.mocked(getAuthUserId).mockReturnValueOnce(null);

    const req = makeRequest(
      'http://localhost:3002/api/analytics/agents/utilization?workspace_id=ws-123',
    );
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns agent utilization data', async () => {
    const queueTasks = [
      { assignee: 'rick', status: 'in_progress' },
      { assignee: 'rick', status: 'inbox' },
      { assignee: 'sage', status: 'planning' },
    ];
    const doneTasks = [
      {
        assignee: 'rick',
        metadata: { claimed_at: '2026-03-15T10:00:00Z' },
        completed_at: '2026-03-15T10:30:00Z',
      },
    ];

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? mockChain(queueTasks) : mockChain(doneTasks);
    });

    const req = makeRequest(
      'http://localhost:3002/api/analytics/agents/utilization?workspace_id=ws-123',
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.agents).toBeDefined();
    expect(Array.isArray(body.agents)).toBe(true);
    // rick should appear (has queue + in_progress + completed)
    const rick = body.agents.find((a: { agent: string }) => a.agent === 'rick');
    expect(rick).toBeDefined();
    expect(rick.inProgress).toBe(1);
    expect(rick.queueDepth).toBe(1);
    expect(rick.completed7d).toBe(1);
    expect(rick.avgMinutes).toBe(30);
  });

  it('filters out agents with zero activity', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      return mockChain([]);
    });

    const req = makeRequest(
      'http://localhost:3002/api/analytics/agents/utilization?workspace_id=ws-123',
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.agents).toHaveLength(0);
  });
});
