import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ---------- Mock setup ----------

const mockInsert = vi.fn();
const mockServiceFrom = vi.fn();

vi.mock('@repo/db/service', () => ({
  createServiceClient: () => ({
    from: (...args: unknown[]) => mockServiceFrom(...args),
  }),
}));

vi.mock('@/lib/api-error', async () => {
  const { NextResponse: NR } = await import('next/server');
  return {
    safeErrorResponse: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NR.json({ error: msg }, { status: 500 });
    },
  };
});

vi.mock('@/lib/csrf', () => ({
  validateOrigin: () => null,
}));

vi.mock('@/lib/rate-limiter', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_WRITE: {},
}));

vi.mock('@/lib/audit-log', () => ({
  auditLog: vi.fn(),
}));

vi.mock('@/lib/track-usage', () => ({
  trackUsage: vi.fn(),
}));

vi.mock('@/lib/plan-enforcement', () => ({
  enforcePlanLimit: vi.fn(async () => null),
}));

// requirePermission — configurable per test
const mockRequirePermission = vi.fn();
vi.mock('@/lib/permissions', () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}));

// parseBody — configurable per test
const mockParseBody = vi.fn();
vi.mock('@/lib/parse-body', () => ({
  parseBody: (...args: unknown[]) => mockParseBody(...args),
  isErrorResponse: (v: unknown) => v instanceof NextResponse,
}));

// Mock generateApiKey to return deterministic values
vi.mock('@/lib/api-keys', () => ({
  generateApiKey: (env: string) => ({
    key: `celune_${env}_test-plaintext-key`,
    hash: 'sha256-hash-value',
    prefix: `celune_${env}_t`,
  }),
}));

import { POST } from '../route';

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3002'), init as never);
}

function grantPermission() {
  mockRequirePermission.mockResolvedValue({
    userId: 'test-user-id',
    resolved: {
      role: null,
      permissions: new Set(['api_keys:manage', 'api_keys:read']),
      isOwner: true,
      isPlatformOwner: true,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  grantPermission();

  // Default: insert succeeds and returns row
  mockInsert.mockReturnValue({
    select: vi.fn(() => ({
      single: vi.fn(async () => ({
        data: {
          id: 'key-id-1',
          workspace_id: 'ws-1',
          org_id: null,
          user_id: 'test-user-id',
          name: 'My API Key',
          key_prefix: 'celune_live_t',
          environment: 'live',
          scopes: ['admin'],
          permission_scopes: [],
          rate_limit_per_minute: 100,
          expires_at: null,
          created_at: '2026-03-06T00:00:00Z',
        },
        error: null,
      })),
    })),
  });

  mockServiceFrom.mockReturnValue({
    insert: mockInsert,
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn(async () => ({ data: [], error: null })),
  });
});

describe('POST /api/api-keys', () => {
  it('returns plaintext_key field (not "key") in the response', async () => {
    mockParseBody.mockResolvedValue({
      name: 'My API Key',
      workspace_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      environment: 'live',
      scopes: ['admin'],
    });

    const req = makeRequest('http://localhost:3002/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'My API Key',
        workspace_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        scopes: ['admin'],
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toHaveProperty('plaintext_key');
    expect(body.plaintext_key).toContain('celune_live_');
    // Must NOT have a bare "key" field (security: only plaintext_key is exposed)
    expect(body).not.toHaveProperty('key');
  });

  it('returns 422 when workspace_id is missing (parseBody returns error)', async () => {
    mockParseBody.mockResolvedValue(
      NextResponse.json(
        { error: 'Validation failed', details: ['workspace_id is required'] },
        { status: 422 },
      ),
    );

    const req = makeRequest('http://localhost:3002/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No workspace' }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toBe('Validation failed');
  });

  it('returns 403 when user lacks api_keys:manage permission', async () => {
    // parseBody runs first — must return valid data so the route reaches requirePermission
    mockParseBody.mockResolvedValue({
      name: 'Forbidden Key',
      workspace_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      environment: 'live',
      scopes: ['admin'],
    });

    mockRequirePermission.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );

    const req = makeRequest('http://localhost:3002/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Forbidden Key',
        workspace_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});

// ---------- Scope mapping ----------

describe('Scope mapping (mapScopesToPermissions)', () => {
  // We test scope mapping indirectly by inspecting what gets passed to insert.
  // The route calls mapScopesToPermissions internally when permission_scopes is not provided.

  it('admin scope expands to all granular permissions', async () => {
    mockParseBody.mockResolvedValue({
      name: 'Admin Key',
      workspace_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      environment: 'live',
      scopes: ['admin'],
    });

    const req = makeRequest('http://localhost:3002/api/api-keys', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    await POST(req);

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        permission_scopes: expect.arrayContaining([
          'tasks:create',
          'tasks:read',
          'tasks:update',
          'tasks:delete',
          'projects:create',
          'projects:read',
          'projects:update',
          'projects:delete',
          'users:read',
          'settings:read',
          'agents:configure',
          'agents:read',
          'analytics:read',
          'webhooks:manage',
          'webhooks:read',
          'api_keys:read',
          'audit_log:read',
        ]),
      }),
    );
  });

  it('write scope expands to task + project CRUD and read-only agents/analytics', async () => {
    mockParseBody.mockResolvedValue({
      name: 'Write Key',
      workspace_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      environment: 'live',
      scopes: ['write'],
    });

    const req = makeRequest('http://localhost:3002/api/api-keys', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    await POST(req);

    const insertedRow = mockInsert.mock.calls[0]?.[0];
    const perms: string[] = insertedRow?.permission_scopes ?? [];

    expect(perms).toContain('tasks:create');
    expect(perms).toContain('tasks:read');
    expect(perms).toContain('tasks:update');
    expect(perms).toContain('projects:create');
    expect(perms).toContain('projects:read');
    expect(perms).toContain('projects:update');
    expect(perms).toContain('agents:read');
    expect(perms).toContain('analytics:read');
    // Should NOT include destructive or admin-only permissions
    expect(perms).not.toContain('tasks:delete');
    expect(perms).not.toContain('projects:delete');
    expect(perms).not.toContain('webhooks:manage');
    expect(perms).not.toContain('api_keys:read');
    expect(perms).not.toContain('audit_log:read');
  });

  it('read scope expands to read-only permissions', async () => {
    mockParseBody.mockResolvedValue({
      name: 'Read Key',
      workspace_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      environment: 'live',
      scopes: ['read'],
    });

    const req = makeRequest('http://localhost:3002/api/api-keys', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    await POST(req);

    const insertedRow = mockInsert.mock.calls[0]?.[0];
    const perms: string[] = insertedRow?.permission_scopes ?? [];

    expect(perms).toEqual(['tasks:read', 'projects:read', 'agents:read', 'analytics:read']);
  });

  it('uses provided permission_scopes when given, ignoring scopes', async () => {
    const customScopes = ['tasks:read', 'webhooks:manage'];
    mockParseBody.mockResolvedValue({
      name: 'Custom Key',
      workspace_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      environment: 'live',
      scopes: ['admin'],
      permission_scopes: customScopes,
    });

    const req = makeRequest('http://localhost:3002/api/api-keys', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    await POST(req);

    const insertedRow = mockInsert.mock.calls[0]?.[0];
    expect(insertedRow?.permission_scopes).toEqual(customScopes);
  });
});
