import './setup-security-mocks';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@repo/db/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'test-user-id' } } }) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        ilike: vi.fn(() => ({
          limit: vi.fn(async () => ({ data: [], error: null })),
        })),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => ({ data: null, error: null })),
      })),
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: {}, error: null })),
        })),
      })),
    })),
  })),
}));

// Mock CSRF validation — allow all origins in tests
vi.mock('@/lib/csrf', () => ({
  validateOrigin: vi.fn(() => null),
}));

// Mock rate limiter — no rate limiting in tests
vi.mock('@/lib/rate-limiter', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_WRITE: { requests: 60, windowMs: 60000 },
  RATE_AI: { requests: 20, windowMs: 60000 },
  RATE_AUTH: { requests: 5, windowMs: 60000 },
}));

// Mock UUID validation — accept all in tests
vi.mock('@repo/db/validation', () => ({
  isValidUuid: vi.fn(() => true),
}));

vi.mock('@/lib/auth', () => ({
  getAuthUserId: () => 'test-user-id',
}));

// Mock permissions — allow all permissions in tests
vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(async () => ({
    userId: 'test-user-id',
    resolved: { permissions: new Set(['*']) },
  })),
}));

vi.mock('@/lib/require-workspace', () => ({
  extractWorkspaceScope: vi.fn(() => ({ workspace_id: '65ea5cdf-758d-4613-903e-f06917717051' })),
  requireWorkspaceMembership: vi.fn(async () => null),
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

const mockGetProjects = vi.fn();
const mockCreateProject = vi.fn();
const mockCreateActivity = vi.fn();
vi.mock('@repo/db/queries', () => ({
  getProjects: (...args: unknown[]) => mockGetProjects(...args),
  createProject: (...args: unknown[]) => mockCreateProject(...args),
  createActivity: (...args: unknown[]) => mockCreateActivity(...args),
}));

import { GET, POST } from '../../api/projects/route';

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'), init as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/projects', () => {
  it('returns projects as JSON', async () => {
    const projects = [
      { id: 'p1', name: 'Alpha', status: 'active' },
      { id: 'p2', name: 'Beta', status: 'paused' },
    ];
    mockGetProjects.mockResolvedValue(projects);

    const res = await GET(
      makeRequest(
        'http://localhost:3002/api/projects?workspace_id=65ea5cdf-758d-4613-903e-f06917717051',
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(projects);
  });

  it('returns 500 on database error', async () => {
    mockGetProjects.mockRejectedValue(new Error('DB down'));

    const res = await GET(
      makeRequest(
        'http://localhost:3002/api/projects?workspace_id=65ea5cdf-758d-4613-903e-f06917717051',
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('DB down');
  });
});

describe('POST /api/projects', () => {
  it('creates a project and returns 201', async () => {
    const created = { id: 'p-new', name: 'New Project', status: 'active' };
    mockCreateProject.mockResolvedValue(created);
    mockCreateActivity.mockResolvedValue({});

    const req = makeRequest(
      'http://localhost:3002/api/projects?workspace_id=65ea5cdf-758d-4613-903e-f06917717051',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Project',
          workspace_id: '65ea5cdf-758d-4613-903e-f06917717051',
        }),
      },
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.name).toBe('New Project');
  });

  it('returns 400 when name is missing', async () => {
    const req = makeRequest(
      'http://localhost:3002/api/projects?workspace_id=65ea5cdf-758d-4613-903e-f06917717051',
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

  it('logs activity after creating a project', async () => {
    mockCreateProject.mockResolvedValue({ id: 'p1', name: 'My Project' });
    mockCreateActivity.mockResolvedValue({});

    const req = makeRequest(
      'http://localhost:3002/api/projects?workspace_id=65ea5cdf-758d-4613-903e-f06917717051',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My Project',
          workspace_id: '65ea5cdf-758d-4613-903e-f06917717051',
        }),
      },
    );
    await POST(req);

    expect(mockCreateActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event_type: 'project.created',
        title: 'Project created: My Project',
      }),
    );
  });

  it('returns 500 on database error', async () => {
    mockCreateProject.mockRejectedValue(new Error('Insert failed'));

    const req = makeRequest(
      'http://localhost:3002/api/projects?workspace_id=65ea5cdf-758d-4613-903e-f06917717051',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Broken',
          workspace_id: '65ea5cdf-758d-4613-903e-f06917717051',
        }),
      },
    );
    const res = await POST(req);

    expect(res.status).toBe(500);
  });
});
