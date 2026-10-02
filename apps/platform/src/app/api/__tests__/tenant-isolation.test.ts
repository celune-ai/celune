import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Tenant Isolation Tests
 *
 * Verifies that users in Workspace A cannot access data from Workspace B.
 * Tests the workspace membership validation added to single-item API routes.
 */

const WS_A = 'aaaaaaaa-0000-4000-a000-000000000001';
const WS_B = 'bbbbbbbb-0000-4000-a000-000000000002';
const USER_A = 'user-a-in-workspace-a';

// --- Mock setup ---

vi.mock('@repo/db/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER_A } } }) },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: null, error: null })),
    })),
  })),
}));

vi.mock('@repo/db/validation', () => ({
  isValidUuid: (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
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

vi.mock('@/lib/csrf', () => ({ validateOrigin: () => null }));
vi.mock('@/lib/rate-limiter', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_WRITE: {},
}));
vi.mock('@/lib/track-usage', () => ({ trackUsage: vi.fn() }));
vi.mock('@/lib/webhooks', () => ({ dispatchWebhook: vi.fn() }));
vi.mock('@/lib/plan-enforcement', () => ({ enforcePlanLimit: vi.fn(async () => null) }));
vi.mock('@/lib/parse-body', () => ({
  parseBody: vi.fn(async (_req: unknown) => ({})),
  isErrorResponse: () => false,
}));
vi.mock('@/lib/schemas/tasks.schema', () => ({
  createTaskSchema: {},
  updateTaskSchema: {},
}));
vi.mock('@/lib/schemas/projects.schema', () => ({
  createProjectSchema: {},
  updateProjectSchema: {},
  updateProjectGroupSchema: {},
}));

// Mock auth — User A is authenticated
const mockGetAuthUserId = vi.fn((): string | null => USER_A);
vi.mock('@/lib/auth', () => ({
  getAuthUserId: (...args: unknown[]) => mockGetAuthUserId(...(args as [])),
}));

// Mock permissions — User A has full permissions (the test is about workspace isolation, not RBAC)
vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(async () => ({
    userId: USER_A,
    resolved: {
      role: null,
      permissions: new Set([
        'tasks:read',
        'tasks:update',
        'tasks:delete',
        'projects:read',
        'projects:update',
        'projects:delete',
      ]),
      isOwner: false,
      isPlatformOwner: false,
    },
  })),
}));

// Mock queries — return data from Workspace B (different from user's workspace)
const mockGetTask = vi.fn();
const mockGetProject = vi.fn();
const mockUpdateTask = vi.fn();
const mockDeleteTask = vi.fn();
const mockCreateActivity = vi.fn();
vi.mock('@repo/db/queries', () => ({
  getTask: (...args: unknown[]) => mockGetTask(...args),
  getProject: (...args: unknown[]) => mockGetProject(...args),
  updateTask: (...args: unknown[]) => mockUpdateTask(...args),
  deleteTask: (...args: unknown[]) => mockDeleteTask(...args),
  createActivity: (...args: unknown[]) => mockCreateActivity(...args),
}));

// Mock workspace membership check — User A is ONLY in Workspace A
const mockRequireWorkspaceMembership = vi.fn(async (_userId: unknown, workspaceId: unknown) => {
  if (workspaceId === WS_A) return null; // Access granted
  // Access denied for any other workspace
  const { NextResponse } = await import('next/server');
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
});

const mockExtractWorkspaceScope = vi.fn((req: NextRequest) => {
  const wsId = req.nextUrl.searchParams.get('workspace_id');
  if (!wsId) {
    return { workspace_id: WS_A }; // Default to WS_A for tests
  }
  return { workspace_id: wsId };
});

vi.mock('@/lib/require-workspace', () => ({
  requireWorkspaceMembership: (a: unknown, b: unknown) => mockRequireWorkspaceMembership(a, b),
  extractWorkspaceScope: (req: NextRequest) => mockExtractWorkspaceScope(req),
  requireWorkspace: vi.fn(async () => null),
  extractRequiredWorkspaceId: vi.fn(),
}));

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'), {
    ...init,
    headers: { 'x-user-id': USER_A, ...(init?.headers ?? {}) },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Tests ---

describe('Tenant Isolation: Tasks', () => {
  // Dynamically import after mocks are set up
  let taskRoutes: typeof import('../tasks/[id]/route');

  beforeEach(async () => {
    taskRoutes = await import('../tasks/[id]/route');
  });

  it('GET /api/tasks/[id] — blocks access to task in another workspace', async () => {
    const taskInWsB = {
      id: '11111111-1111-4000-a000-000000000001',
      title: 'Secret task in WS B',
      workspace_id: WS_B,
      status: 'inbox',
    };
    mockGetTask.mockResolvedValue(taskInWsB);

    const req = makeRequest(`http://localhost:3002/api/tasks/${taskInWsB.id}?workspace_id=${WS_B}`);
    const res = await taskRoutes.GET(req, { params: Promise.resolve({ id: taskInWsB.id }) });

    expect(res.status).toBe(403);
    expect(mockRequireWorkspaceMembership).toHaveBeenCalledWith(USER_A, WS_B);
  });

  it('GET /api/tasks/[id] — allows access to task in own workspace', async () => {
    const taskInWsA = {
      id: '22222222-2222-4000-a000-000000000002',
      title: 'My task in WS A',
      workspace_id: WS_A,
      status: 'inbox',
    };
    mockGetTask.mockResolvedValue(taskInWsA);

    const req = makeRequest(`http://localhost:3002/api/tasks/${taskInWsA.id}?workspace_id=${WS_A}`);
    const res = await taskRoutes.GET(req, { params: Promise.resolve({ id: taskInWsA.id }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('My task in WS A');
  });

  it('PUT /api/tasks/[id] — blocks update to task in another workspace', async () => {
    const taskInWsB = {
      id: '33333333-3333-4000-a000-000000000003',
      title: 'Secret task',
      workspace_id: WS_B,
      status: 'inbox',
      metadata: {},
    };
    mockGetTask.mockResolvedValue(taskInWsB);

    const req = makeRequest(
      `http://localhost:3002/api/tasks/${taskInWsB.id}?workspace_id=${WS_B}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      },
    );
    const res = await taskRoutes.PUT(req, { params: Promise.resolve({ id: taskInWsB.id }) });

    expect(res.status).toBe(403);
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it('DELETE /api/tasks/[id] — blocks delete of task in another workspace', async () => {
    const taskInWsB = {
      id: '44444444-4444-4000-a000-000000000004',
      title: 'Secret task',
      workspace_id: WS_B,
      status: 'inbox',
      metadata: {},
    };
    mockGetTask.mockResolvedValue(taskInWsB);

    const req = makeRequest(
      `http://localhost:3002/api/tasks/${taskInWsB.id}?workspace_id=${WS_B}`,
      {
        method: 'DELETE',
      },
    );
    const res = await taskRoutes.DELETE(req, { params: Promise.resolve({ id: taskInWsB.id }) });

    expect(res.status).toBe(403);
    expect(mockDeleteTask).not.toHaveBeenCalled();
  });
});

describe('Tenant Isolation: Projects', () => {
  let projectRoutes: typeof import('../projects/[id]/route');

  beforeEach(async () => {
    projectRoutes = await import('../projects/[id]/route');
  });

  it('GET /api/projects/[id] — blocks access to project in another workspace', async () => {
    const projectInWsB = {
      id: '55555555-5555-4000-a000-000000000005',
      name: 'Secret project in WS B',
      workspace_id: WS_B,
      status: 'active',
    };
    mockGetProject.mockResolvedValue(projectInWsB);

    const req = makeRequest(
      `http://localhost:3002/api/projects/${projectInWsB.id}?workspace_id=${WS_B}`,
    );
    const res = await projectRoutes.GET(req, { params: Promise.resolve({ id: projectInWsB.id }) });

    expect(res.status).toBe(403);
  });

  it('GET /api/projects/[id] — allows access to project in own workspace', async () => {
    const projectInWsA = {
      id: '66666666-6666-4000-a000-000000000006',
      name: 'My project in WS A',
      workspace_id: WS_A,
      status: 'active',
    };
    mockGetProject.mockResolvedValue(projectInWsA);

    const req = makeRequest(
      `http://localhost:3002/api/projects/${projectInWsA.id}?workspace_id=${WS_A}`,
    );
    const res = await projectRoutes.GET(req, { params: Promise.resolve({ id: projectInWsA.id }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('My project in WS A');
  });
});

describe('Tenant Isolation: Workspace Scoped Queries', () => {
  it('GET /api/tasks/[id] — workspace_id is always passed to getTask', async () => {
    const taskInWsA = {
      id: '77777777-7777-4000-a000-000000000007',
      title: 'Scoped task',
      workspace_id: WS_A,
      status: 'inbox',
    };
    mockGetTask.mockResolvedValue(taskInWsA);

    const taskRoutes = await import('../tasks/[id]/route');
    const req = makeRequest(`http://localhost:3002/api/tasks/${taskInWsA.id}?workspace_id=${WS_A}`);
    const res = await taskRoutes.GET(req, { params: Promise.resolve({ id: taskInWsA.id }) });

    expect(res.status).toBe(200);
    // Verify getTask was called with workspace_id parameter
    expect(mockGetTask).toHaveBeenCalledWith(expect.anything(), taskInWsA.id, WS_A);
  });

  it('GET /api/projects/[id] — workspace_id is always passed to getProject', async () => {
    const projectInWsA = {
      id: '88888888-8888-4000-a000-000000000008',
      name: 'Scoped project',
      workspace_id: WS_A,
      status: 'active',
    };
    mockGetProject.mockResolvedValue(projectInWsA);

    const projectRoutes = await import('../projects/[id]/route');
    const req = makeRequest(
      `http://localhost:3002/api/projects/${projectInWsA.id}?workspace_id=${WS_A}`,
    );
    const res = await projectRoutes.GET(req, {
      params: Promise.resolve({ id: projectInWsA.id }),
    });

    expect(res.status).toBe(200);
    // Verify getProject was called with workspace_id parameter
    expect(mockGetProject).toHaveBeenCalledWith(expect.anything(), projectInWsA.id, WS_A);
  });
});

describe('Tenant Isolation: Unauthenticated Access', () => {
  it('GET /api/tasks/[id] — returns 401 for unauthenticated requests', async () => {
    mockGetAuthUserId.mockReturnValueOnce(null);

    const taskRoutes = await import('../tasks/[id]/route');
    const req = new NextRequest(
      new URL('http://localhost:3002/api/tasks/11111111-1111-4000-a000-000000000001'),
    );
    const res = await taskRoutes.GET(req, {
      params: Promise.resolve({ id: '11111111-1111-4000-a000-000000000001' }),
    });

    expect(res.status).toBe(401);
  });

  it('GET /api/projects/[id] — returns 401 for unauthenticated requests', async () => {
    mockGetAuthUserId.mockReturnValueOnce(null);

    const projectRoutes = await import('../projects/[id]/route');
    const req = new NextRequest(
      new URL('http://localhost:3002/api/projects/11111111-1111-4000-a000-000000000001'),
    );
    const res = await projectRoutes.GET(req, {
      params: Promise.resolve({ id: '11111111-1111-4000-a000-000000000001' }),
    });

    expect(res.status).toBe(401);
  });
});
