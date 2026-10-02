import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  getAuthUserId: vi.fn(() => 'test-user-id'),
}));

vi.mock('@/lib/require-workspace', () => ({
  requireWorkspaceMembership: vi.fn(async () => null),
}));

vi.mock('@repo/db/validation', () => ({
  isValidUuid: vi.fn(() => true),
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

import { GET } from '../agents/[id]/budget/route';

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'));
}

/** Chainable mock that resolves via .single() or as thenable. */
function mockChain(data: unknown, error: unknown = null) {
  const result = { data, error };
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.in = vi.fn(self);
  chain.gte = vi.fn(self);
  chain.lt = vi.fn(() => Promise.resolve(result));
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/agents/[id]/budget', () => {
  const params = Promise.resolve({ id: 'rick' });

  it('returns 401 without auth', async () => {
    const { getAuthUserId } = await import('@/lib/auth');
    vi.mocked(getAuthUserId).mockReturnValueOnce(null);

    const req = makeRequest('http://localhost:3002/api/agents/rick/budget?workspace_id=ws-123');
    const res = await GET(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 400 without workspace_id', async () => {
    const req = makeRequest('http://localhost:3002/api/agents/rick/budget');
    const res = await GET(req, { params });
    expect(res.status).toBe(400);
  });

  it('returns budget data with no cap set', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // agent_configs query
        return mockChain(null);
      }
      if (callCount === 2) {
        // claude_usage query
        return mockChain([{ total_cost_usd: 0.5, task_id: 'task-1' }]);
      }
      // tasks query
      return mockChain([{ id: 'task-1' }]);
    });

    const req = makeRequest('http://localhost:3002/api/agents/rick/budget?workspace_id=ws-123');
    const res = await GET(req, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.agent_id).toBe('rick');
    expect(body.budget_cap_usd).toBeNull();
    expect(body.total_spend_usd).toBe(0.5);
    expect(body.exceeded).toBe(false);
    expect(body.cost_per_outcome.completed_tasks).toBe(1);
    expect(body.cost_per_outcome.avg_cost_per_task).toBe(0.5);
  });

  it('reports exceeded when spend > cap', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return mockChain({ budget_cap_usd: 1.0 });
      }
      // usage query — no task_ids, so no tasks query needed
      return mockChain([
        { total_cost_usd: 0.8, task_id: null },
        { total_cost_usd: 0.5, task_id: null },
      ]);
    });

    const req = makeRequest('http://localhost:3002/api/agents/rick/budget?workspace_id=ws-123');
    const res = await GET(req, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.budget_cap_usd).toBe(1.0);
    expect(body.total_spend_usd).toBe(1.3);
    expect(body.exceeded).toBe(true);
    expect(body.utilization_pct).toBe(130);
  });
});
