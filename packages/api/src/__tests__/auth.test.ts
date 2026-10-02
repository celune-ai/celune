import { createScope } from '@celuneai/core';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';
import { jwtConfigFromEnv, mintHostJwt, verifyHostJwt } from '../auth/jwt.ts';
import { sha256Hex } from '../auth/api-key.ts';
import { createAuthenticator } from '../auth/authenticate.ts';
import { hasScope } from '../auth/types.ts';
import { createTestApi } from '../testing/index.ts';

const WS_A = '11111111-1111-4111-8111-111111111111';
const WS_B = '22222222-2222-4222-8222-222222222222';

describe('API key auth', () => {
  it('accepts a valid key and scopes reads to its workspace', async () => {
    const api = await createTestApi();
    api.store.seedTask(createScope({ workspaceId: WS_A }), { title: 'A task' });
    api.store.seedTask(createScope({ workspaceId: WS_B }), { title: 'B task' });
    const key = await api.addKey({ workspaceId: WS_A });
    const res = await api.request('/tasks', { token: key.raw });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ title: string }>;
    expect(rows.map((r) => r.title)).toEqual(['A task']);
  });

  it('rejects a missing, malformed, or wrong key', async () => {
    const api = await createTestApi();
    const key = await api.addKey({ workspaceId: WS_A });
    expect((await api.request('/tasks')).status).toBe(401);
    expect((await api.request('/tasks', { token: 'nonsense' })).status).toBe(401);
    expect((await api.request('/tasks', { token: `${key.raw}x` })).status).toBe(401);
    const wrongPrefix = key.raw.replace('_live_', '_prod_');
    expect((await api.request('/tasks', { token: wrongPrefix })).status).toBe(401);
  });

  it('skips auth only for the exact health path', async () => {
    const api = await createTestApi({ basePath: '/v1' });
    expect((await api.request('/health')).status).toBe(200);
    expect((await api.request('/tasks/health')).status).toBe(401);
    expect((await api.request('/tasks/mcp', { method: 'POST' })).status).toBe(401);
  });

  it('accepts the X-API-Key header', async () => {
    const api = await createTestApi();
    const key = await api.addKey({ workspaceId: WS_A });
    const res = await api.request('/tasks', { headers: { 'x-api-key': key.raw } });
    expect(res.status).toBe(200);
  });

  it('rejects revoked and expired keys', async () => {
    const api = await createTestApi();
    const revoked = await api.addKey({ workspaceId: WS_A, revokedAt: '2026-01-01T00:00:00Z' });
    const expired = await api.addKey({ workspaceId: WS_A, expiresAt: '2020-01-01T00:00:00Z' });
    const r1 = await api.request('/tasks', { token: revoked.raw });
    expect(r1.status).toBe(401);
    expect(await r1.json()).toEqual({ error: 'API key has been revoked' });
    const r2 = await api.request('/tasks', { token: expired.raw });
    expect(r2.status).toBe(401);
    expect(await r2.json()).toEqual({ error: 'API key has expired' });
  });

  it('needs write scope for mutations and admin covers everything', async () => {
    const api = await createTestApi();
    const readOnly = await api.addKey({ workspaceId: WS_A, scopes: ['read'] });
    const admin = await api.addKey({ workspaceId: WS_A, scopes: ['admin'] });
    const body = JSON.stringify({ title: 'x' });
    expect(
      (await api.request('/tasks', { method: 'POST', body, token: readOnly.raw })).status,
    ).toBe(403);
    expect((await api.request('/tasks', { method: 'POST', body, token: admin.raw })).status).toBe(
      201,
    );
    expect(hasScope({ scopes: ['write'] }, 'read')).toBe(true);
    expect(hasScope({ scopes: ['read'] }, 'write')).toBe(false);
  });

  it('answers 403 when an API key names a workspace the host does not grant', async () => {
    const api = await createTestApi();
    const key = await api.addKey({ workspaceId: WS_A });
    const res = await api.request(`/tasks?workspace_id=${WS_B}`, { token: key.raw });
    expect(res.status).toBe(403);
  });

  it('lets the host grant another workspace to an API key', async () => {
    const api = await createTestApi({
      host: { resolveWorkspace: async () => ({ workspaceId: WS_B, orgId: null }) },
    });
    api.store.seedTask(createScope({ workspaceId: WS_B }), { title: 'B task' });
    const key = await api.addKey({ workspaceId: WS_A });
    const res = await api.request(`/tasks?workspace_id=${WS_B}`, { token: key.raw });
    expect(res.status).toBe(200);
    expect((await res.json()).map((t: { title: string }) => t.title)).toEqual(['B task']);
  });
});

describe('Host JWT auth', () => {
  it('accepts a valid HS256 token and scopes it to workspace_id', async () => {
    const api = await createTestApi();
    api.store.seedTask(createScope({ workspaceId: WS_A }), { title: 'A task' });
    api.store.seedTask(createScope({ workspaceId: WS_B }), { title: 'B task' });
    const token = await api.mintJwt({ workspace_id: WS_A, sub: 'host-user-7' });
    const res = await api.request('/tasks', { token });
    expect(res.status).toBe(200);
    expect((await res.json()).map((t: { title: string }) => t.title)).toEqual(['A task']);
  });

  it('rejects an expired token', async () => {
    const api = await createTestApi();
    const token = await new SignJWT({ workspace_id: WS_A, scopes: ['write'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode('test-secret-with-at-least-32-bytes-of-entropy'));
    const res = await api.request('/tasks', { token });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Token expired' });
  });

  it('rejects a token signed with another secret and one without exp', async () => {
    const api = await createTestApi();
    const forged = await new SignJWT({ workspace_id: WS_A, scopes: ['write'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-different-secret-with-at-least-32-bytes'));
    expect((await api.request('/tasks', { token: forged })).status).toBe(401);
    const noExp = await new SignJWT({ workspace_id: WS_A, scopes: ['write'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u')
      .sign(new TextEncoder().encode('test-secret-with-at-least-32-bytes-of-entropy'));
    expect((await api.request('/tasks', { token: noExp })).status).toBe(401);
  });

  it('answers 403 when a token names a different workspace, even for admins', async () => {
    const api = await createTestApi({
      host: { resolveWorkspace: async () => ({ workspaceId: WS_B, orgId: null }) },
    });
    const token = await api.mintJwt({ workspace_id: WS_A, scopes: ['admin'] });
    const res = await api.request(`/tasks?workspace_id=${WS_B}`, { token });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Token is scoped to another workspace' });
  });

  it('honours scopes carried in the token', async () => {
    const api = await createTestApi();
    const readOnly = await api.mintJwt({ workspace_id: WS_A, scopes: ['read'] });
    const res = await api.request('/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'x' }),
      token: readOnly,
    });
    expect(res.status).toBe(403);
  });

  it('verifies against a JWKS key set', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = await exportJWK(publicKey);
    const getKey = createLocalJWKSet({ keys: [{ ...jwk, alg: 'ES256', kid: 'k1' }] });
    const token = await new SignJWT({ workspace_id: WS_A, scopes: ['read'], org_id: 'org-1' })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setSubject('jwks-user')
      .setExpirationTime('5m')
      .sign(privateKey);
    const result = await verifyHostJwt(token, { getKey });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auth).toMatchObject({
        principal: 'jwt',
        workspaceId: WS_A,
        orgId: 'org-1',
        userId: 'jwks-user',
        scopes: ['read'],
        keyId: null,
      });
    }
  });

  it('reads its configuration from the environment', () => {
    expect(jwtConfigFromEnv({})).toBeUndefined();
    const longEnough = 'x'.repeat(32);
    expect(jwtConfigFromEnv({ CELUNE_HOST_JWT_SECRET: longEnough })).toEqual({
      secret: longEnough,
      jwksUrl: undefined,
      issuer: undefined,
      audience: undefined,
    });
    expect(jwtConfigFromEnv({ CELUNE_HOST_JWKS_URL: 'https://host.example/jwks' })?.jwksUrl).toBe(
      'https://host.example/jwks',
    );
  });

  it('rejects an HS256 secret shorter than 32 bytes without echoing it', async () => {
    const short = 'y'.repeat(31);
    expect(() => jwtConfigFromEnv({ CELUNE_HOST_JWT_SECRET: short })).toThrowError(
      /at least 32 bytes \(got 31\).*openssl rand -hex 32/,
    );
    try {
      jwtConfigFromEnv({ CELUNE_HOST_JWT_SECRET: short });
    } catch (error) {
      expect((error as Error).message).not.toContain(short);
    }
    const claims = { sub: 'u', workspace_id: WS_A, scopes: ['read' as const] };
    expect(() => mintHostJwt(claims, { secret: short })).toThrowError(/at least 32 bytes/);
    await expect(verifyHostJwt('a.b.c', { secret: short })).rejects.toThrowError(
      /at least 32 bytes/,
    );
  });
});

describe('API key lookup', () => {
  const PREFIX = 'testkey';
  const keyFor = (suffix: string) => `${PREFIX}_live_ab${suffix}`;
  const record = async (id: string, raw: string) => ({
    id,
    workspace_id: id === 'mine' ? WS_A : WS_B,
    org_id: null,
    user_id: `user-${id}`,
    key_hash: await sha256Hex(raw),
    scopes: ['read'],
    environment: 'live' as const,
    expires_at: null,
    revoked_at: null,
  });
  const call = (authenticate: ReturnType<typeof createAuthenticator>, raw: string) =>
    authenticate(new Request('http://x/tasks', { headers: { authorization: `Bearer ${raw}` } }));

  it('picks the key whose hash matches when several share a stored prefix', async () => {
    const mine = keyFor('mine-000000');
    const rows = [await record('other', keyFor('other-00000')), await record('mine', mine)];
    const authenticate = createAuthenticator({
      apiKeyPrefix: PREFIX,
      apiKeys: { findByPrefix: async () => rows },
    });
    const result = await call(authenticate, mine);
    expect(result.ok && result.auth.keyId).toBe('mine');
    expect(result.ok && result.auth.workspaceId).toBe(WS_A);
    expect((await call(authenticate, keyFor('nobody-0000'))).ok).toBe(false);
  });

  it('answers 503 instead of 401 when the lookup throws', async () => {
    const authenticate = createAuthenticator({
      apiKeyPrefix: PREFIX,
      apiKeys: {
        findByPrefix: async () => {
          throw new Error('connection reset');
        },
      },
    });
    const result = await call(authenticate, keyFor('mine-000000'));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.status).toBe(503);
  });
});
