import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ---------- Mock setup ----------

type Row = Record<string, unknown>;

const state: {
  existing: Row | null;
  membership: Row | null;
  inserted: Row | null;
  insertError: Row | null;
  updates: Array<{ id: string; patch: Row }>;
  insertedRows: Row[];
} = {
  existing: null,
  membership: null,
  inserted: null,
  insertError: null,
  updates: [],
  insertedRows: [],
};

function providerKeysTable() {
  return {
    select: () => ({
      eq: () => ({ eq: () => ({ single: async () => ({ data: state.existing, error: null }) }) }),
      single: async () => ({ data: state.inserted, error: state.insertError }),
    }),
    update: (patch: Row) => ({
      eq: async (_col: string, id: string) => {
        state.updates.push({ id, patch });
        return { error: null };
      },
    }),
    insert: (row: Row) => {
      state.insertedRows.push(row);
      return {
        select: () => ({
          single: async () => ({ data: state.inserted, error: state.insertError }),
        }),
      };
    },
  };
}

function orgMembersTable() {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({ single: async () => ({ data: state.membership, error: null }) }),
        }),
      }),
    }),
  };
}

vi.mock('@repo/db/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => (table === 'org_members' ? orgMembersTable() : providerKeysTable()),
  }),
}));

vi.mock('@/lib/api-error', async () => {
  const { NextResponse: NR } = await import('next/server');
  return {
    safeErrorResponse: (e: unknown) =>
      NR.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 }),
  };
});

vi.mock('@/lib/csrf', () => ({ validateOrigin: () => null }));
vi.mock('@/lib/rate-limiter', () => ({ applyRateLimit: vi.fn(async () => null) }));
const mockAuditLog = vi.fn();
vi.mock('@/lib/audit-log', () => ({ auditLog: (...args: unknown[]) => mockAuditLog(...args) }));

const mockRequirePermission = vi.fn();
vi.mock('@/lib/permissions', () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}));

vi.mock('@/lib/parse-body', () => ({
  parseBody: async (request: NextRequest) => request.json(),
  isErrorResponse: (v: unknown) => v instanceof NextResponse,
}));

vi.mock('@/lib/provider-key-crypto', () => ({
  validateMasterKey: () => true,
  decryptProviderKey: () => 'plain',
  encryptProviderKey: (key: string) => ({ encryptedKey: `enc(${key})`, iv: 'iv-1' }),
  extractKeySuffix: (key: string) => key.slice(-4),
}));

import { PUT } from '../[id]/route';

const KEY_ID = '11111111-1111-4111-8111-111111111111';
const WS_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_WS = '33333333-3333-4333-8333-333333333333';

function makeRequest(query: string, body: Row): NextRequest {
  return new NextRequest(new URL(`/api/provider-keys/${KEY_ID}${query}`, 'http://localhost:3002'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } as never);
}

const params = { params: Promise.resolve({ id: KEY_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  state.existing = {
    id: KEY_ID,
    provider: 'openai',
    name: 'Team key',
    org_id: 'org-1',
    workspace_id: WS_ID,
  };
  state.membership = { org_id: 'org-1' };
  state.inserted = {
    id: 'new-key-id',
    provider: 'openai',
    name: 'Team key',
    key_suffix: 'wxyz',
    is_active: true,
    created_at: '2026-09-27T00:00:00Z',
  };
  state.insertError = null;
  state.updates = [];
  state.insertedRows = [];
  mockRequirePermission.mockResolvedValue({ userId: 'user-1' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 })),
  );
});

describe('PUT /api/provider-keys/[id] (rotate)', () => {
  it('validates, deactivates the old row, and inserts the new key in the same scope', async () => {
    const res = await PUT(makeRequest(`?workspace_id=${WS_ID}`, { key: 'sk-new-wxyz' }), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'new-key-id', key_suffix: 'wxyz' });
    expect(state.updates).toEqual([{ id: KEY_ID, patch: { is_active: false } }]);
    expect(state.insertedRows).toHaveLength(1);
    expect(state.insertedRows[0]).toMatchObject({
      org_id: 'org-1',
      workspace_id: WS_ID,
      user_id: 'user-1',
      provider: 'openai',
      name: 'Team key',
      encrypted_key: 'enc(sk-new-wxyz)',
      key_iv: 'iv-1',
      key_suffix: 'wxyz',
      is_active: true,
      last_validation_status: 'valid',
    });
    expect(state.insertedRows[0]).not.toHaveProperty('key');
    expect(mockRequirePermission).toHaveBeenCalledWith(expect.anything(), WS_ID, 'settings:manage');
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'provider_key.rotated', resource_id: 'new-key-id' }),
      expect.anything(),
    );
  });

  it('refuses to rotate a key that belongs to a different workspace', async () => {
    const res = await PUT(makeRequest(`?workspace_id=${OTHER_WS}`, { key: 'sk-new-wxyz' }), params);

    expect(res.status).toBe(403);
    expect(state.updates).toEqual([]);
    expect(state.insertedRows).toEqual([]);
  });

  it('refuses to rotate a workspace key through the org-wide scope', async () => {
    const res = await PUT(makeRequest('', { key: 'sk-new-wxyz' }), params);

    expect(res.status).toBe(403);
    expect(state.insertedRows).toEqual([]);
  });

  it('refuses when the caller is not a member of the key owner org', async () => {
    state.membership = null;
    const res = await PUT(makeRequest(`?workspace_id=${WS_ID}`, { key: 'sk-new-wxyz' }), params);

    expect(res.status).toBe(403);
    expect(state.insertedRows).toEqual([]);
  });

  it('keeps the old key active when the new key fails provider validation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    const res = await PUT(makeRequest(`?workspace_id=${WS_ID}`, { key: 'sk-bad-key1' }), params);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Key validation failed: invalid' });
    expect(state.updates).toEqual([]);
    expect(state.insertedRows).toEqual([]);
  });

  it('re-activates the old key when the insert fails', async () => {
    state.insertError = { message: 'insert failed' };
    state.inserted = null;
    const res = await PUT(makeRequest(`?workspace_id=${WS_ID}`, { key: 'sk-new-wxyz' }), params);

    expect(res.status).toBe(500);
    expect(state.updates).toEqual([
      { id: KEY_ID, patch: { is_active: false } },
      { id: KEY_ID, patch: { is_active: true } },
    ]);
  });

  it('returns 404 when the key is not active', async () => {
    state.existing = null;
    const res = await PUT(makeRequest(`?workspace_id=${WS_ID}`, { key: 'sk-new-wxyz' }), params);
    expect(res.status).toBe(404);
  });
});
