import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// Mock CSRF validation — allow all origins in tests
vi.mock('@/lib/csrf', () => ({
  validateOrigin: vi.fn(() => null),
}));

// Mock rate limiter — no rate limiting in tests
vi.mock('@/lib/rate-limiter', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_READ: { requests: 120, windowMs: 60000 },
  RATE_WRITE: { requests: 60, windowMs: 60000 },
  RATE_AI: { requests: 20, windowMs: 60000 },
  RATE_AUTH: { requests: 5, windowMs: 60000 },
}));

// Mock permissions — allow all permissions in tests
vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(async () => ({
    userId: 'test-user-id',
    resolved: { permissions: new Set(['*']) },
  })),
}));

// Mock UUID validation — accept all in tests
vi.mock('@repo/db/validation', () => ({
  isValidUuid: vi.fn(() => true),
}));

vi.mock('@repo/db/server', () => ({
  createClient: vi.fn(async () => ({})),
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

vi.mock('@/lib/parse-body', () => ({
  parseBody: async (request: Request, _schema: unknown) => {
    const body = await request.json();
    // Minimal validation: acknowledgeActivitySchema requires ids array with min 1
    if (body.ids !== undefined) {
      if (!Array.isArray(body.ids) || body.ids.length === 0) {
        const { NextResponse } = require('next/server');
        return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
      }
      return body;
    }
    // createActivitySchema requires event_type, severity, source, title
    if (!body.event_type || !body.severity || !body.source || !body.title) {
      const { NextResponse } = require('next/server');
      return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
    }
    return body;
  },
  isErrorResponse: (v: unknown) => v instanceof NextResponse,
}));

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

const mockGetActivity = vi.fn();
const mockCreateActivity = vi.fn();
const mockAcknowledgeActivities = vi.fn();
vi.mock('@repo/db/queries', () => ({
  getActivity: (...args: unknown[]) => mockGetActivity(...args),
  createActivity: (...args: unknown[]) => mockCreateActivity(...args),
  acknowledgeActivities: (...args: unknown[]) => mockAcknowledgeActivities(...args),
}));

import { GET, POST, PATCH } from '../../api/activity/route';

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'), init as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/activity', () => {
  it('returns activity entries', async () => {
    const data = { data: [{ id: '1', title: 'Test' }], total: 1 };
    mockGetActivity.mockResolvedValue(data);

    const req = makeRequest('http://localhost:3002/api/activity?workspace_id=ws-test-123');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
  });

  it('passes filter params to query', async () => {
    mockGetActivity.mockResolvedValue({ data: [], total: 0 });

    const req = makeRequest(
      'http://localhost:3002/api/activity?workspace_id=ws-test-123&event_type=task.created&severity=info&limit=5&offset=10',
    );
    await GET(req);

    expect(mockGetActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event_type: 'task.created',
        severity: 'info',
        limit: 5,
        offset: 10,
      }),
    );
  });

  it('parses severity_in as comma-separated array', async () => {
    mockGetActivity.mockResolvedValue({ data: [], total: 0 });

    const req = makeRequest(
      'http://localhost:3002/api/activity?workspace_id=ws-test-123&severity_in=info,warning',
    );
    await GET(req);

    expect(mockGetActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        severity_in: ['info', 'warning'],
      }),
    );
  });

  it('passes acknowledged filter', async () => {
    mockGetActivity.mockResolvedValue({ data: [], total: 0 });

    const req = makeRequest(
      'http://localhost:3002/api/activity?workspace_id=ws-test-123&acknowledged=false',
    );
    await GET(req);

    expect(mockGetActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ acknowledged: false }),
    );
  });

  it('returns 500 on error', async () => {
    mockGetActivity.mockRejectedValue(new Error('Query failed'));

    const req = makeRequest('http://localhost:3002/api/activity?workspace_id=ws-test-123');
    const res = await GET(req);

    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/activity', () => {
  it('acknowledges activities by ids', async () => {
    mockAcknowledgeActivities.mockResolvedValue(undefined);

    const req = makeRequest('http://localhost:3002/api/activity?workspace_id=ws-test-123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
      }),
    });
    const res = await PATCH(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.acknowledged).toBe(2);
  });

  it('returns 400 when ids is not an array', async () => {
    const req = makeRequest('http://localhost:3002/api/activity?workspace_id=ws-test-123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: 'not-array' }),
    });
    const res = await PATCH(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 when ids is empty', async () => {
    const req = makeRequest('http://localhost:3002/api/activity?workspace_id=ws-test-123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [] }),
    });
    const res = await PATCH(req);

    expect(res.status).toBe(400);
  });
});

describe('POST /api/activity', () => {
  it('creates an activity entry and returns 201', async () => {
    const created = { id: 'act-1', event_type: 'deploy', title: 'Deployed v2' };
    mockCreateActivity.mockResolvedValue(created);

    const req = makeRequest('http://localhost:3002/api/activity?workspace_id=ws-test-123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'deploy',
        severity: 'info',
        source: 'ci',
        title: 'Deployed v2',
      }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.title).toBe('Deployed v2');
  });

  it('returns 400 when required fields are missing', async () => {
    const req = makeRequest('http://localhost:3002/api/activity?workspace_id=ws-test-123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: 'deploy' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 500 on database error', async () => {
    mockCreateActivity.mockRejectedValue(new Error('DB error'));

    const req = makeRequest('http://localhost:3002/api/activity?workspace_id=ws-test-123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'test',
        severity: 'info',
        source: 'test',
        title: 'Test',
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
  });
});
