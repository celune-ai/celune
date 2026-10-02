import './setup-security-mocks';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@repo/db/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'test-user-id' } } }) },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: null, error: null })),
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

vi.mock('@/lib/auth', () => ({
  getAuthUserId: () => 'test-user-id',
}));

vi.mock('@/lib/require-workspace', () => ({
  requireWorkspaceMembership: vi.fn(async () => null),
  extractWorkspaceScope: vi.fn(() => ({ workspace_id: 'ws-test-123' })),
  requireWorkspace: vi.fn(async () => null),
  extractRequiredWorkspaceId: vi.fn(),
}));

const mockGetProjectGroups = vi.fn();
const mockCreateProjectGroup = vi.fn();
const mockGetProjectGroup = vi.fn();
const mockUpdateProjectGroup = vi.fn();
const mockDeleteProjectGroup = vi.fn();
const mockCreateActivity = vi.fn();
vi.mock('@repo/db/queries', () => ({
  getProjectGroups: (...args: unknown[]) => mockGetProjectGroups(...args),
  createProjectGroup: (...args: unknown[]) => mockCreateProjectGroup(...args),
  getProjectGroup: (...args: unknown[]) => mockGetProjectGroup(...args),
  updateProjectGroup: (...args: unknown[]) => mockUpdateProjectGroup(...args),
  deleteProjectGroup: (...args: unknown[]) => mockDeleteProjectGroup(...args),
  createActivity: (...args: unknown[]) => mockCreateActivity(...args),
}));

import { GET, POST } from '../../api/project-groups/route';
import { GET as GET_ONE, PUT, DELETE } from '../../api/project-groups/[id]/route';

const VALID_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_ID_2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const MISSING_ID = '00000000-0000-0000-0000-000000000000';

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'), init as never);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/project-groups', () => {
  it('returns groups as JSON', async () => {
    const groups = [
      { id: VALID_ID, name: 'Q1 Goals', sort_order: 1000 },
      { id: VALID_ID_2, name: 'Q2 Goals', sort_order: 2000 },
    ];
    mockGetProjectGroups.mockResolvedValue(groups);

    const res = await GET(
      makeRequest('http://localhost:3002/api/project-groups?workspace_id=ws-test-123'),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(groups);
  });

  it('returns 500 on error', async () => {
    mockGetProjectGroups.mockRejectedValue(new Error('DB down'));

    const res = await GET(
      makeRequest('http://localhost:3002/api/project-groups?workspace_id=ws-test-123'),
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('DB down');
  });
});

describe('POST /api/project-groups', () => {
  it('creates a group and returns 201', async () => {
    const created = { id: VALID_ID, name: 'New Group' };
    mockCreateProjectGroup.mockResolvedValue(created);
    mockCreateActivity.mockResolvedValue({});

    const req = makeRequest('http://localhost:3002/api/project-groups?workspace_id=ws-test-123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Group' }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.name).toBe('New Group');
  });

  it('returns 400 when name is missing', async () => {
    const req = makeRequest('http://localhost:3002/api/project-groups?workspace_id=ws-test-123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });
});

describe('GET /api/project-groups/[id]', () => {
  it('returns a single group', async () => {
    const group = { id: VALID_ID, name: 'Q1 Goals', workspace_id: 'ws-test-123' };
    mockGetProjectGroup.mockResolvedValue(group);

    const res = await GET_ONE(
      makeRequest(`http://localhost:3002/api/project-groups?workspace_id=ws-test-123/${VALID_ID}`),
      makeParams(VALID_ID),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Q1 Goals');
  });

  it('returns 400 for invalid UUID', async () => {
    const res = await GET_ONE(
      makeRequest('http://localhost:3002/api/project-groups?workspace_id=ws-test-123/not-a-uuid'),
      makeParams('not-a-uuid'),
    );

    expect(res.status).toBe(400);
  });

  it('returns 404 for missing group', async () => {
    mockGetProjectGroup.mockRejectedValue(new Error('PGRST116: not found'));

    const res = await GET_ONE(
      makeRequest(
        `http://localhost:3002/api/project-groups?workspace_id=ws-test-123/${MISSING_ID}`,
      ),
      makeParams(MISSING_ID),
    );

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/project-groups/[id]', () => {
  it('updates a group', async () => {
    const updated = { id: VALID_ID, name: 'Updated' };
    mockGetProjectGroup.mockResolvedValue({
      id: VALID_ID,
      name: 'Old',
      workspace_id: 'ws-test-123',
    });
    mockUpdateProjectGroup.mockResolvedValue(updated);
    mockCreateActivity.mockResolvedValue({});

    const req = makeRequest(
      `http://localhost:3002/api/project-groups?workspace_id=ws-test-123/${VALID_ID}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      },
    );
    const res = await PUT(req, makeParams(VALID_ID));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Updated');
  });
});

describe('DELETE /api/project-groups/[id]', () => {
  it('deletes a group and returns 204', async () => {
    mockGetProjectGroup.mockResolvedValue({
      id: VALID_ID,
      name: 'Old Group',
      workspace_id: 'ws-test-123',
    });
    mockDeleteProjectGroup.mockResolvedValue(undefined);
    mockCreateActivity.mockResolvedValue({});

    const res = await DELETE(
      makeRequest(`http://localhost:3002/api/project-groups/${VALID_ID}?workspace_id=ws-test-123`, {
        method: 'DELETE',
      }),
      makeParams(VALID_ID),
    );

    expect(res.status).toBe(204);
    expect(mockDeleteProjectGroup).toHaveBeenCalledWith(expect.anything(), VALID_ID, 'ws-test-123');
  });
});
