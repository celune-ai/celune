// @vitest-environment node
import './setup-security-mocks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { verifyHostJwt } from '@celuneai/api';
import { requirePermission } from '@/lib/permissions';

vi.mock('@repo/db/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { org_id: 'org-1' }, error: null }) }),
      }),
    }),
  }),
}));

vi.mock('@/lib/auth', () => ({ getAuthUserId: vi.fn(() => 'test-user-id') }));

import { POST } from '../embed/token/route';

const SECRET = 'embed-test-secret-with-at-least-32-bytes';
const WS = '65ea5cdf-758d-4613-903e-f06917717051';

function request(workspaceId: string | null = WS) {
  const url = new URL('http://localhost:3002/api/embed/token');
  if (workspaceId) url.searchParams.set('workspace_id', workspaceId);
  return new NextRequest(url, { method: 'POST' });
}

beforeEach(() => {
  vi.stubEnv('CELUNE_HOST_JWT_SECRET', SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/embed/token', () => {
  it('mints a write token scoped to the workspace with task and project permission keys', async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.expires_in).toBe(600);

    const verified = await verifyHostJwt(body.token, { secret: SECRET });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.auth).toMatchObject({
      principal: 'jwt',
      userId: 'test-user-id',
      workspaceId: WS,
      orgId: 'org-1',
      scopes: ['write'],
    });
    expect(verified.auth.permissions).toContain('tasks:delete');
    expect(verified.auth.permissions).not.toContain('billing:manage');
  });

  it('mints a read token for a role without write keys', async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce({
      userId: 'viewer-1',
      resolved: {
        role: null,
        permissions: new Set(['tasks:read', 'projects:read']),
        isOwner: false,
        isPlatformOwner: false,
      },
    } as never);
    const body = await (await POST(request())).json();
    const verified = await verifyHostJwt(body.token, { secret: SECRET });
    expect(verified.ok && verified.auth.scopes).toEqual(['read']);
    expect(verified.ok && verified.auth.permissions).toEqual(['tasks:read', 'projects:read']);
  });

  it('answers 503 when the signing secret is not configured', async () => {
    vi.stubEnv('CELUNE_HOST_JWT_SECRET', '');
    const res = await POST(request());
    expect(res.status).toBe(503);
  });

  it('answers 503 and logs the length rule when the signing secret is under 32 bytes', async () => {
    const short = 'z'.repeat(16);
    vi.stubEnv('CELUNE_HOST_JWT_SECRET', short);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(request());
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain('bytes');
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/at least 32 bytes/));
    expect(log.mock.calls.flat().join(' ')).not.toContain(short);
    log.mockRestore();
  });

  it('includes the read keys the user holds so the board can load', async () => {
    const body = await (await POST(request())).json();
    const verified = await verifyHostJwt(body.token, { secret: SECRET });
    expect(verified.ok && verified.auth.permissions).toEqual(
      expect.arrayContaining(['tasks:read', 'projects:read']),
    );
  });

  it('carries only the single write key a user holds, and no unknown task keys', async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce({
      userId: 'commenter-1',
      resolved: {
        role: null,
        permissions: new Set(['tasks:read', 'projects:read', 'tasks:update', 'tasks:assign']),
        isOwner: false,
        isPlatformOwner: false,
      },
    } as never);
    const body = await (await POST(request())).json();
    const verified = await verifyHostJwt(body.token, { secret: SECRET });
    expect(verified.ok && verified.auth.scopes).toEqual(['write']);
    expect(verified.ok && verified.auth.permissions).toEqual([
      'tasks:read',
      'tasks:update',
      'projects:read',
    ]);
  });

  it('answers 400 without a workspace', async () => {
    const res = await POST(request(null));
    expect(res.status).toBe(400);
  });
});
