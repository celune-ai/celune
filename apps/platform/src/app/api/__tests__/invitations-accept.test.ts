/**
 * POST /api/invitations/accept adds the invitee as an active org_members row
 * (the table seats are counted from) and syncs Cloud seats.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const USER_ID = 'invitee-1';
const TOKEN = '00000000-0000-4000-8000-000000000001';

vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(() => USER_ID) }));
vi.mock('@/lib/csrf', () => ({ validateOrigin: vi.fn(async () => null) }));
vi.mock('@/lib/rate-limiter', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_AUTH: { limit: 10, windowMs: 60000 },
}));

const mockSyncSeats = vi.fn(async () => {});
vi.mock('@/lib/billing-seats', () => ({
  syncSeats: (...args: unknown[]) => mockSyncSeats(...(args as [])),
}));

/** Rows each table answers with, and every write the route makes. */
let rows: Record<string, unknown>;
const writes: Array<{ table: string; op: string; values: unknown; options?: unknown }> = [];

function query(table: string) {
  const resolved = () => ({ data: rows[table] ?? null, error: null });
  const q: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
  };
  for (const m of ['select', 'eq']) q[m] = vi.fn(() => q);
  q.single = vi.fn(async () => resolved());
  q.maybeSingle = vi.fn(async () => resolved());
  for (const op of ['insert', 'update', 'upsert']) {
    q[op] = vi.fn((values: unknown, options?: unknown) => {
      writes.push({ table, op, values, options });
      return q;
    });
  }
  return q;
}

vi.mock('@repo/db/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => query(table),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: { email: 'invitee@example.com' } } })),
      },
    },
  }),
}));

import { POST } from '../invitations/accept/route';

function accept() {
  return POST(
    new NextRequest(new URL('http://localhost:3002/api/invitations/accept'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    } as never),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  rows = {
    workspace_invitations: {
      id: 'inv-1',
      workspace_id: 'ws-1',
      email: 'invitee@example.com',
      role: 'member',
      status: 'pending',
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    },
    workspaces: { id: 'ws-1', org_id: 'org-1', name: 'Main' },
    roles: { id: 'role-member' },
  };
});

describe('POST /api/invitations/accept', () => {
  it('adds an active org_members row without overwriting an existing one, then syncs seats', async () => {
    const res = await accept();

    expect(res.status).toBe(200);
    const member = writes.find((w) => w.table === 'org_members');
    expect(member).toEqual({
      table: 'org_members',
      op: 'upsert',
      values: {
        user_id: USER_ID,
        org_id: 'org-1',
        role_id: 'role-member',
        is_owner: false,
        is_active: true,
      },
      options: { onConflict: 'user_id,org_id', ignoreDuplicates: true },
    });
    expect(mockSyncSeats).toHaveBeenCalledWith('org-1');
  });
});
