// @vitest-environment node
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const SECRET = 'platform-test-secret-with-32-bytes-min';
const WS = '11111111-1111-4111-8111-111111111111';

vi.mock('@repo/db/service', () => ({
  createServiceClient: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
      };
      return q;
    },
  }),
}));

vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, resetAt: new Date() })),
  applyRateLimit: vi.fn(async () => null),
  RATE_READ: { limit: 120, windowMs: 60_000 },
  RATE_WRITE: { limit: 60, windowMs: 60_000 },
}));

vi.mock('@repo/db/queries', () => ({ createActivity: vi.fn(async () => null) }));
vi.mock('@/lib/core', () => ({ getCoreServices: vi.fn(() => ({})) }));
vi.mock('@/lib/ai-job-queue/callbacks', () => ({ dispatchJobCallback: vi.fn() }));
vi.mock('@/lib/agent-employment', () => ({
  isAgentEmployed: vi.fn(async () => true),
  getEmployedAgents: vi.fn(async () => []),
  getEmployedAgentIds: vi.fn(async () => new Set()),
}));
vi.mock('@/lib/mcp/instructions-cache', () => ({ getInstructions: vi.fn(async () => '') }));

function mint(claims: Record<string, unknown>, expiresIn = '5m') {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('host-user')
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(SECRET));
}

let routes: typeof import('@/app/api/v1/[[...route]]/route');
let mcpAuth: typeof import('@/lib/mcp/auth');
let registry: typeof import('@/lib/mcp/registry');

beforeAll(async () => {
  vi.stubEnv('CELUNE_HOST_JWT_SECRET', SECRET);
  routes = await import('@/app/api/v1/[[...route]]/route');
  mcpAuth = await import('@/lib/mcp/auth');
  registry = await import('@/lib/mcp/registry');
}, 300_000);

describe('/api/v1 mount', () => {
  it('serves health without credentials', async () => {
    const res = await routes.GET(new NextRequest('http://localhost/api/v1/health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('answers 401 for a request without credentials', async () => {
    const res = await routes.GET(new NextRequest('http://localhost/api/v1/tasks'));
    expect(res.status).toBe(401);
  });

  it('answers 401 for an unknown API key', async () => {
    const res = await routes.GET(
      new NextRequest('http://localhost/api/v1/tasks', {
        headers: { authorization: `Bearer celune_live_${'x'.repeat(40)}` },
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid API key' });
  });

  it('answers 403 when a host JWT names another workspace', async () => {
    const token = await mint({ workspace_id: WS, scopes: ['read'] });
    const res = await routes.GET(
      new NextRequest(
        'http://localhost/api/v1/tasks?workspace_id=22222222-2222-4222-8222-222222222222',
        {
          headers: { authorization: `Bearer ${token}` },
        },
      ),
    );
    expect(res.status).toBe(403);
  });
});

describe('MCP authentication', () => {
  it('accepts a host JWT and yields a jwt principal', async () => {
    const token = await mint({ workspace_id: WS, scopes: ['write'] });
    const auth = await mcpAuth.authenticate(
      new NextRequest('http://localhost/api/mcp', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(auth).toMatchObject({
      principal: 'jwt',
      workspaceId: WS,
      userId: 'host-user',
      keyId: null,
    });
  });

  it('keeps the JSON-RPC error shape and key hint for a missing credential', async () => {
    const res = await mcpAuth.authenticate(new NextRequest('http://localhost/api/mcp'));
    expect(res).toBeInstanceOf(Response);
    const body = await (res as Response).json();
    expect((res as Response).status).toBe(401);
    expect(body.error.code).toBe(-32001);
    expect(body.error.message).toMatch(/^API key required\. Use Authorization: Bearer /);
  });

  it('refuses an embed token (JWT with a permissions claim) on /api/mcp', async () => {
    const token = await mint({
      workspace_id: WS,
      scopes: ['write'],
      permissions: ['tasks:read', 'tasks:create'],
    });
    const res = await mcpAuth.authenticate(
      new NextRequest('http://localhost/api/mcp', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
    const body = await (res as Response).json();
    expect(body.error).toEqual({
      code: -32001,
      message: 'Embed tokens cannot call MCP. Use an API key.',
    });
  });

  it('rejects an expired host JWT', async () => {
    const token = await new SignJWT({ workspace_id: WS, scopes: ['write'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('host-user')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(new TextEncoder().encode(SECRET));
    const res = await mcpAuth.authenticate(
      new NextRequest('http://localhost/api/mcp', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect((res as Response).status).toBe(401);
  });
});

describe('MCP registry', () => {
  it('registers 27 tools with the platform whoami and filters by scope', () => {
    const admin = registry.getAvailableTools({
      principal: 'api_key',
      workspaceId: WS,
      orgId: null,
      userId: 'u',
      scopes: ['admin'],
      keyId: 'k',
      environment: 'live',
      realtimeEnabled: false,
    });
    const names = admin.map((t) => t.name);
    expect(registry.getToolCount()).toBe(27);
    expect(names.filter((n) => n === 'whoami')).toHaveLength(1);
    expect(admin.find((t) => t.name === 'whoami')?.description).toMatch(/onboarding/);
    expect(names).toEqual(expect.arrayContaining(['recall_memory', 'sync_pr_review', 'claim_job']));

    const readOnly = registry.getAvailableTools({
      principal: 'jwt',
      workspaceId: WS,
      orgId: null,
      userId: 'u',
      scopes: ['read'],
      keyId: null,
      environment: 'live',
      realtimeEnabled: false,
    });
    expect(readOnly.map((t) => t.name)).not.toContain('create_task');
  });
});
