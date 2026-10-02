import './setup-security-mocks';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock @repo/db/server
vi.mock('@repo/db/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'test-user-id' } } }) },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: null, error: null })),
    })),
  })),
}));

vi.mock('@/lib/api-error', async () => {
  const { NextResponse } = await import('next/server');
  return {
    safeErrorResponse: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    },
    ApiError: class extends Error {
      statusCode: number;
      userMessage: string;
      constructor(s: number, m: string) {
        super(m);
        this.statusCode = s;
        this.userMessage = m;
      }
    },
  };
});

// Mock @repo/db/queries
const mockGetTasks = vi.fn();
const mockCreateTask = vi.fn();
const mockGetTask = vi.fn();
const mockCreateActivity = vi.fn();
vi.mock('@repo/db/queries', () => ({
  getTasks: (...args: unknown[]) => mockGetTasks(...args),
  createTask: (...args: unknown[]) => mockCreateTask(...args),
  getTask: (...args: unknown[]) => mockGetTask(...args),
  createActivity: (...args: unknown[]) => mockCreateActivity(...args),
}));

vi.mock('@/lib/require-workspace', () => ({
  extractWorkspaceScope: vi.fn(() => ({ workspace_id: '65ea5cdf-758d-4613-903e-f06917717051' })),
  requireWorkspaceMembership: vi.fn(async () => null),
}));

vi.mock('@/lib/plan-enforcement', () => ({
  enforcePlanLimit: vi.fn(async () => null),
}));

vi.mock('@/lib/webhooks', () => ({
  dispatchWebhook: vi.fn(async () => undefined),
}));

vi.mock('@/lib/track-usage', () => ({
  trackUsage: vi.fn(async () => undefined),
}));

vi.mock('@/lib/auth', () => ({
  getAuthUserId: vi.fn(() => 'test-user-id'),
}));

import { GET, POST } from '../../api/tasks/route';

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'), init as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/tasks', () => {
  it('returns tasks as JSON', async () => {
    const tasks = [
      { id: '1', title: 'Task one', status: 'inbox' },
      { id: '2', title: 'Task two', status: 'done' },
    ];
    mockGetTasks.mockResolvedValue(tasks);

    const req = makeRequest(
      'http://localhost:3002/api/tasks?workspace_id=65ea5cdf-758d-4613-903e-f06917717051',
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(tasks);
  });

  it('passes status filter from search params', async () => {
    mockGetTasks.mockResolvedValue([]);

    const req = makeRequest(
      'http://localhost:3002/api/tasks?workspace_id=65ea5cdf-758d-4613-903e-f06917717051&status=in_progress',
    );
    await GET(req);

    expect(mockGetTasks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'in_progress' }),
    );
  });

  it('passes project_id filter from search params', async () => {
    mockGetTasks.mockResolvedValue([]);

    const req = makeRequest(
      'http://localhost:3002/api/tasks?workspace_id=65ea5cdf-758d-4613-903e-f06917717051&project_id=proj-1',
    );
    await GET(req);

    expect(mockGetTasks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ project_id: 'proj-1' }),
    );
  });

  it('defaults top_level_only to true', async () => {
    mockGetTasks.mockResolvedValue([]);

    const req = makeRequest(
      'http://localhost:3002/api/tasks?workspace_id=65ea5cdf-758d-4613-903e-f06917717051',
    );
    await GET(req);

    expect(mockGetTasks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ top_level_only: true }),
    );
  });

  it('returns 500 on database error', async () => {
    mockGetTasks.mockRejectedValue(new Error('Connection refused'));

    const req = makeRequest(
      'http://localhost:3002/api/tasks?workspace_id=65ea5cdf-758d-4613-903e-f06917717051',
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Connection refused');
  });
});

describe('POST /api/tasks', () => {
  it('creates a task and returns 201', async () => {
    const created = { id: 'new-1', title: 'New task', status: 'inbox' };
    mockCreateTask.mockResolvedValue(created);
    mockCreateActivity.mockResolvedValue({});

    const req = makeRequest(
      'http://localhost:3002/api/tasks?workspace_id=65ea5cdf-758d-4613-903e-f06917717051',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'New task',
          workspace_id: '65ea5cdf-758d-4613-903e-f06917717051',
        }),
      },
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.title).toBe('New task');
  });

  it('returns 400 when title is missing', async () => {
    const req = makeRequest(
      'http://localhost:3002/api/tasks?workspace_id=65ea5cdf-758d-4613-903e-f06917717051',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 when title exceeds 500 characters', async () => {
    const longTitle = 'a'.repeat(501);
    const req = makeRequest(
      'http://localhost:3002/api/tasks?workspace_id=65ea5cdf-758d-4613-903e-f06917717051',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: longTitle }),
      },
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('rejects deep nesting (parent already has a parent)', async () => {
    mockGetTask.mockResolvedValue({ id: 'parent-1', parent_id: 'grandparent-1' });

    const req = makeRequest(
      'http://localhost:3002/api/tasks?workspace_id=65ea5cdf-758d-4613-903e-f06917717051',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Child task',
          parent_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          workspace_id: '65ea5cdf-758d-4613-903e-f06917717051',
        }),
      },
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Cannot nest deeper than one level');
  });

  it('returns 400 when depends_on is not an array', async () => {
    const req = makeRequest(
      'http://localhost:3002/api/tasks?workspace_id=65ea5cdf-758d-4613-903e-f06917717051',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Test',
          depends_on: 'not-array',
          workspace_id: '65ea5cdf-758d-4613-903e-f06917717051',
        }),
      },
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('logs activity after creating a task', async () => {
    mockCreateTask.mockResolvedValue({ id: 'new-1', title: 'My task' });
    mockCreateActivity.mockResolvedValue({});

    const req = makeRequest(
      'http://localhost:3002/api/tasks?workspace_id=65ea5cdf-758d-4613-903e-f06917717051',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'My task',
          workspace_id: '65ea5cdf-758d-4613-903e-f06917717051',
        }),
      },
    );
    await POST(req);

    expect(mockCreateActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event_type: 'task.created',
        title: 'Task created: My task',
      }),
    );
  });

  it('returns 500 on database error', async () => {
    mockCreateTask.mockRejectedValue(new Error('Insert failed'));

    const req = makeRequest(
      'http://localhost:3002/api/tasks?workspace_id=65ea5cdf-758d-4613-903e-f06917717051',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Will fail',
          workspace_id: '65ea5cdf-758d-4613-903e-f06917717051',
        }),
      },
    );
    const res = await POST(req);

    expect(res.status).toBe(500);
  });
});
