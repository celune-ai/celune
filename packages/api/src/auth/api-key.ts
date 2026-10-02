import { failure, isApiScope, type ApiScope, type AuthResult } from './types.ts';

/** The api_keys row a host returns for a key prefix. */
export interface ApiKeyRecord {
  id: string;
  workspace_id: string;
  org_id: string | null;
  user_id: string;
  key_hash: string;
  scopes: string[];
  environment: 'live' | 'test';
  expires_at: string | null;
  revoked_at: string | null;
  realtime_enabled?: boolean | null;
  rate_limit_per_minute?: number | null;
}

export interface RateLimitVerdict {
  allowed: boolean;
  retryAfterSeconds?: number;
  limit?: number;
  resetAt?: Date;
}

/** Host-supplied access to api_keys; the package never talks to a database. */
export interface ApiKeyLookup {
  /**
   * Rows whose stored key_prefix equals `prefix`. The stored prefix keeps only a
   * few random characters, so unrelated keys can share it: return every match
   * and the hash picks the key. Throw when the lookup itself fails, so an outage
   * is not reported as an invalid key.
   */
  findByPrefix(prefix: string): Promise<ApiKeyRecord | ApiKeyRecord[] | null>;
  checkRateLimit?(record: ApiKeyRecord): Promise<RateLimitVerdict>;
  /** Called after a successful check, for last_used_at bookkeeping. */
  touch?(record: ApiKeyRecord): Promise<void> | void;
}

const RANDOM_PREFIX_CHARS = 8;

export function apiKeyPrefixLength(apiKeyPrefix: string): number {
  return apiKeyPrefix.length + RANDOM_PREFIX_CHARS;
}

export function parseKeyEnvironment(rawKey: string, apiKeyPrefix: string): 'live' | 'test' | null {
  if (rawKey.startsWith(`${apiKeyPrefix}_live_`)) return 'live';
  if (rawKey.startsWith(`${apiKeyPrefix}_test_`)) return 'test';
  return null;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function authenticateApiKey(
  rawKey: string,
  options: { apiKeyPrefix: string; lookup: ApiKeyLookup },
): Promise<AuthResult> {
  const environment = parseKeyEnvironment(rawKey, options.apiKeyPrefix);
  if (!environment) return failure(401, 'Invalid API key format');

  let found: ApiKeyRecord | ApiKeyRecord[] | null;
  try {
    found = await options.lookup.findByPrefix(
      rawKey.slice(0, apiKeyPrefixLength(options.apiKeyPrefix)),
    );
  } catch {
    return failure(503, 'API key check is unavailable; retry shortly', { 'Retry-After': '1' });
  }
  const hash = await sha256Hex(rawKey);
  const candidates = found === null ? [] : Array.isArray(found) ? found : [found];
  const record = candidates.find((row) => constantTimeEqual(row.key_hash, hash));
  if (!record) return failure(401, 'Invalid API key');
  if (record.revoked_at) return failure(401, 'API key has been revoked');
  if (record.expires_at && new Date(record.expires_at) < new Date()) {
    return failure(401, 'API key has expired');
  }

  if (options.lookup.checkRateLimit) {
    const verdict = await options.lookup.checkRateLimit(record);
    if (!verdict.allowed) {
      const headers: Record<string, string> = {};
      if (verdict.retryAfterSeconds !== undefined) {
        headers['Retry-After'] = String(verdict.retryAfterSeconds);
      }
      if (verdict.limit !== undefined) {
        headers['X-RateLimit-Limit'] = String(verdict.limit);
        headers['X-RateLimit-Remaining'] = '0';
      }
      if (verdict.resetAt) {
        headers['X-RateLimit-Reset'] = String(Math.floor(verdict.resetAt.getTime() / 1000));
      }
      return failure(429, 'API key rate limit exceeded', headers);
    }
  }

  await options.lookup.touch?.(record);

  return {
    ok: true,
    auth: {
      principal: 'api_key',
      workspaceId: record.workspace_id,
      orgId: record.org_id ?? null,
      userId: record.user_id,
      scopes: record.scopes.filter(isApiScope) as ApiScope[],
      keyId: record.id,
      environment: record.environment,
      realtimeEnabled: !!record.realtime_enabled,
    },
  };
}
