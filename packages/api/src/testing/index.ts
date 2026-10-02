import { createServices, type Gate, type Services } from '@celuneai/core';
import { InMemoryBlobs, InMemoryStore } from '@celuneai/core/testing';
import { SignJWT } from 'jose';
import { sha256Hex, type ApiKeyRecord } from '../auth/api-key.ts';
import { createAuthenticator } from '../auth/authenticate.ts';
import type { ApiScope } from '../auth/types.ts';
import type { ApiHost, JobCrypto } from '../host.ts';
import { createApi } from '../http/app.ts';
import type { McpToolHandler } from '../mcp/types.ts';

export const TEST_PREFIX = 'testkey';
export const TEST_JWT_SECRET = 'test-secret-with-at-least-32-bytes-of-entropy';

export interface TestApiOptions {
  host?: ApiHost;
  basePath?: string;
  extraTools?: McpToolHandler[];
  clock?: () => Date;
  /** Defaults to the open-source NoopGate. */
  gate?: Gate;
}

export interface TestKey {
  raw: string;
  record: ApiKeyRecord;
}

export interface TestApi {
  app: ReturnType<typeof createApi>;
  store: InMemoryStore;
  blobs: InMemoryBlobs;
  services: Services;
  keys: Map<string, ApiKeyRecord>;
  /** Registers a key; the raw value is what a request sends. */
  addKey(input: {
    workspaceId: string;
    userId?: string;
    orgId?: string | null;
    scopes?: ApiScope[];
    environment?: 'live' | 'test';
    expiresAt?: string | null;
    revokedAt?: string | null;
  }): Promise<TestKey>;
  mintJwt(claims: {
    sub?: string;
    workspace_id: string;
    org_id?: string | null;
    scopes?: ApiScope[];
    permissions?: string[];
    expiresIn?: string;
  }): Promise<string>;
  request(path: string, init?: RequestInit & { token?: string }): Promise<Response>;
}

export function utf8ToHex(text: string): string {
  return Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
}

export function hexToUtf8(hex: string): string {
  const clean = hex.startsWith('\\x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

/** Symmetric fake: hex in, hex out, so tests can round-trip payloads without real keys. */
export const fakeJobCrypto: JobCrypto = {
  decrypt(encryptedHex) {
    return hexToUtf8(encryptedHex);
  },
  encrypt(plaintext) {
    return { result_encrypted: '\\x' + utf8ToHex(plaintext), result_iv: '\\x' + '00'.repeat(12) };
  },
  verifyHmac(fields, hmac) {
    return hmac === `hmac:${fields.jobId}:${fields.nonce}`;
  },
};

let keyCounter = 0;

export async function createTestApi(options: TestApiOptions = {}): Promise<TestApi> {
  const store = new InMemoryStore({ clock: options.clock });
  const blobs = new InMemoryBlobs();
  const services = createServices(store, {
    clock: options.clock,
    attachmentBlobs: blobs,
    gate: options.gate,
  });
  const keys = new Map<string, ApiKeyRecord>();
  const authenticate = createAuthenticator({
    apiKeyPrefix: TEST_PREFIX,
    apiKeys: { findByPrefix: async (prefix) => keys.get(prefix) ?? null },
    jwt: { secret: TEST_JWT_SECRET },
  });
  const host: ApiHost = { jobs: { crypto: fakeJobCrypto }, ...options.host };
  const app = createApi({
    services,
    authenticate,
    host,
    basePath: options.basePath,
    mcp: { enableJsonResponse: true, extraTools: options.extraTools },
  });

  return {
    app,
    store,
    blobs,
    services,
    keys,
    async addKey(input) {
      keyCounter += 1;
      const environment = input.environment ?? 'live';
      // The stored prefix covers the first two random chars, so they must differ per key.
      const random = `${keyCounter.toString(36).padStart(2, '0')}${'a'.repeat(30)}`;
      const raw = `${TEST_PREFIX}_${environment}_${random}`;
      const record: ApiKeyRecord = {
        id: `key-${keyCounter}`,
        workspace_id: input.workspaceId,
        org_id: input.orgId ?? null,
        user_id: input.userId ?? 'user-1',
        key_hash: await sha256Hex(raw),
        scopes: input.scopes ?? ['write'],
        environment,
        expires_at: input.expiresAt ?? null,
        revoked_at: input.revokedAt ?? null,
        realtime_enabled: false,
      };
      keys.set(raw.slice(0, TEST_PREFIX.length + 8), record);
      return { raw, record };
    },
    mintJwt(claims) {
      return new SignJWT({
        workspace_id: claims.workspace_id,
        org_id: claims.org_id ?? null,
        scopes: claims.scopes ?? ['write'],
        ...(claims.permissions ? { permissions: claims.permissions } : {}),
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(claims.sub ?? 'jwt-user')
        .setIssuedAt()
        .setExpirationTime(claims.expiresIn ?? '15m')
        .sign(new TextEncoder().encode(TEST_JWT_SECRET));
    },
    async request(path, init = {}) {
      const { token, ...rest } = init;
      const headers = new Headers(rest.headers);
      if (token) headers.set('authorization', `Bearer ${token}`);
      if (rest.body && !(rest.body instanceof FormData) && !headers.has('content-type'))
        headers.set('content-type', 'application/json');
      return app.request(`${options.basePath ?? ''}${path}`, { ...rest, headers });
    },
  };
}
