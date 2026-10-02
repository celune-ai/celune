import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * The stored key_prefix keeps two random characters, so two keys can share it.
 * Lookup must pick the row whose hash matches, and a database error must not
 * read as an invalid key.
 */

const lookup = vi.hoisted(() => ({ result: { data: [] as unknown[], error: null as unknown } }));

vi.mock('@repo/db/service', () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.update = () => chain;
  chain.eq = (column: string) =>
    column === 'key_prefix'
      ? Promise.resolve(lookup.result)
      : { then: (fn: (r: { error: null }) => void) => fn({ error: null }) };
  return { createServiceClient: () => ({ from: () => chain }) };
});
vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, resetAt: new Date() })),
}));

import { authenticateApiKey } from '../api-key-auth';
import { API_KEY_PREFIX, generateApiKey } from '../api-keys';

function row(id: string, keyHash: string) {
  return {
    id,
    workspace_id: `ws-${id}`,
    org_id: null,
    user_id: `user-${id}`,
    key_hash: keyHash,
    scopes: ['read'],
    environment: 'live',
    expires_at: null,
    revoked_at: null,
    rate_limit_per_minute: 60,
    realtime_enabled: false,
  };
}

function request(key: string) {
  return new NextRequest('http://localhost/api/mcp/health', {
    headers: { authorization: `Bearer ${key}` },
  });
}

beforeEach(() => {
  lookup.result = { data: [], error: null };
});

describe('authenticateApiKey (platform)', () => {
  it('picks the key whose hash matches when two keys share a prefix', async () => {
    const mine = generateApiKey('live');
    const other = generateApiKey('live');
    lookup.result = { data: [row('other', other.hash), row('mine', mine.hash)], error: null };

    const result = await authenticateApiKey(request(mine.key));
    expect(result).not.toBeInstanceOf(NextResponse);
    expect(result).toMatchObject({ keyId: 'mine', workspaceId: 'ws-mine' });
  });

  it('rejects a key whose hash matches no row', async () => {
    const other = generateApiKey('live');
    lookup.result = { data: [row('other', other.hash)], error: null };

    const result = await authenticateApiKey(request(`${API_KEY_PREFIX}_live_nomatch`));
    expect((result as NextResponse).status).toBe(401);
  });

  it('answers 503 when the lookup fails', async () => {
    lookup.result = { data: null as unknown as unknown[], error: { message: 'connection reset' } };

    const result = await authenticateApiKey(request(generateApiKey('live').key));
    expect((result as NextResponse).status).toBe(503);
  });
});
