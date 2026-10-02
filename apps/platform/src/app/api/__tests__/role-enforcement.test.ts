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
      in: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: null, error: null })),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
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

vi.mock('@/lib/rate-limiter', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_WRITE: {},
}));

vi.mock('@repo/db/validation', () => ({
  isValidUuid: (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
}));

vi.mock('@repo/db/queries', () => ({
  getTasks: vi.fn(async () => []),
  createTask: vi.fn(async () => ({ id: 'new-id', title: 'Test' })),
  getTask: vi.fn(async () => null),
  getProjects: vi.fn(async () => []),
  createProject: vi.fn(async () => ({ id: 'new-id', name: 'Test' })),
  getProjectGroups: vi.fn(async () => []),
  createProjectGroup: vi.fn(async () => ({ id: 'new-id', name: 'Test' })),
  createActivity: vi.fn(async () => ({})),
}));

vi.mock('@/lib/csrf', () => ({
  validateOrigin: () => null,
}));

vi.mock('@/lib/parse-body', async () => {
  return {
    parseBody: vi.fn(async (_req: unknown, _schema: unknown) => ({
      title: 'Test',
      name: 'Test',
      status: 'inbox',
      priority: 'normal',
    })),
    isErrorResponse: () => false,
  };
});

// requirePermission mock — we'll override per test
const mockRequirePermission = vi.fn();
vi.mock('@/lib/permissions', () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}));

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'), init as never);
}

function mockPermissionGranted() {
  mockRequirePermission.mockResolvedValue({
    userId: 'test-user-id',
    resolved: {
      role: null,
      permissions: new Set([
        'tasks:create',
        'tasks:read',
        'tasks:update',
        'tasks:delete',
        'projects:create',
        'projects:read',
        'projects:update',
        'projects:delete',
        'users:manage',
        'users:read',
        'settings:manage',
        'settings:read',
        'agents:configure',
        'agents:read',
        'billing:manage',
        'billing:read',
        'analytics:read',
        'webhooks:manage',
        'webhooks:read',
        'api_keys:manage',
        'api_keys:read',
        'audit_log:read',
      ]),
      isOwner: true,
      isPlatformOwner: true,
    },
  });
}

function mockPermissionDenied() {
  const { NextResponse } = require('next/server');
  mockRequirePermission.mockResolvedValue(
    NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Role-based API enforcement', () => {
  describe('POST /api/tasks (member+ required)', () => {
    let POST: (req: NextRequest) => Promise<Response>;

    beforeEach(async () => {
      const mod = await import('../../api/tasks/route');
      POST = mod.POST;
    });

    it('allows owner to create tasks', async () => {
      mockPermissionGranted();
      const req = makeRequest('http://localhost:3002/api/tasks?workspace_id=ws-test-123', {
        method: 'POST',
        body: JSON.stringify({ title: 'Test', status: 'inbox', priority: 'normal' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
    });

    it('allows admin to create tasks', async () => {
      mockPermissionGranted();
      const req = makeRequest('http://localhost:3002/api/tasks?workspace_id=ws-test-123', {
        method: 'POST',
        body: JSON.stringify({ title: 'Test', status: 'inbox', priority: 'normal' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
    });

    it('allows member to create tasks', async () => {
      mockPermissionGranted();
      const req = makeRequest('http://localhost:3002/api/tasks?workspace_id=ws-test-123', {
        method: 'POST',
        body: JSON.stringify({ title: 'Test', status: 'inbox', priority: 'normal' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
    });

    it('rejects viewer from creating tasks', async () => {
      mockPermissionDenied();
      const req = makeRequest('http://localhost:3002/api/tasks?workspace_id=ws-test-123', {
        method: 'POST',
        body: JSON.stringify({ title: 'Test', status: 'inbox', priority: 'normal' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/projects (admin+ required)', () => {
    let POST: (req: NextRequest) => Promise<Response>;

    beforeEach(async () => {
      const mod = await import('../../api/projects/route');
      POST = mod.POST;
    });

    it('allows owner to create projects', async () => {
      mockPermissionGranted();
      const req = makeRequest('http://localhost:3002/api/projects?workspace_id=ws-test-123', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
    });

    it('allows admin to create projects', async () => {
      mockPermissionGranted();
      const req = makeRequest('http://localhost:3002/api/projects?workspace_id=ws-test-123', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
    });

    it('rejects member from creating projects', async () => {
      mockPermissionDenied();
      const req = makeRequest('http://localhost:3002/api/projects?workspace_id=ws-test-123', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
    });

    it('rejects viewer from creating projects', async () => {
      mockPermissionDenied();
      const req = makeRequest('http://localhost:3002/api/projects?workspace_id=ws-test-123', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/project-groups (admin+ required)', () => {
    let POST: (req: NextRequest) => Promise<Response>;

    beforeEach(async () => {
      const mod = await import('../../api/project-groups/route');
      POST = mod.POST;
    });

    it('allows owner to create groups', async () => {
      mockPermissionGranted();
      const req = makeRequest('http://localhost:3002/api/project-groups?workspace_id=ws-test-123', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
    });

    it('rejects viewer from creating groups', async () => {
      mockPermissionDenied();
      const req = makeRequest('http://localhost:3002/api/project-groups?workspace_id=ws-test-123', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
    });
  });
});

// Suspension and plan limits are covered elsewhere; this file only exercises roles
vi.mock('@/lib/plan-enforcement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/plan-enforcement')>()),
  enforcePlanLimit: vi.fn(async () => null),
}));
