import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { timingSafeEqual } from 'crypto';
import {
  API_KEY_BEARER_PREFIX,
  PREFIX_LENGTH,
  hashApiKey,
  parseKeyEnvironment,
} from '@/lib/api-keys';
import { checkRateLimit } from '@/lib/rate-limiter';
import type { ApiKeyScope } from '@repo/types';

export interface ApiKeyContext {
  keyId: string;
  workspaceId: string;
  orgId: string | null;
  userId: string;
  scopes: ApiKeyScope[];
  environment: 'live' | 'test';
  realtimeEnabled: boolean;
}

/**
 * Authenticate a request using an API key from the Authorization header.
 * Format: `Authorization: Bearer <prefix>_live_xxx` or `X-API-Key: <prefix>_live_xxx`
 *
 * Returns ApiKeyContext on success, or null if no API key is present.
 * Returns NextResponse if the key is invalid/expired/revoked.
 */
export async function authenticateApiKey(
  request: NextRequest,
): Promise<ApiKeyContext | NextResponse | null> {
  // Extract key from Authorization header or X-API-Key
  let rawKey: string | null = null;

  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith(`Bearer ${API_KEY_BEARER_PREFIX}`)) {
    rawKey = authHeader.slice(7); // Remove "Bearer "
  }

  if (!rawKey) {
    rawKey = request.headers.get('x-api-key');
  }

  // No API key present — return null to allow fallback to session auth
  if (!rawKey || !rawKey.startsWith(API_KEY_BEARER_PREFIX)) {
    return null;
  }

  const environment = parseKeyEnvironment(rawKey);
  if (!environment) {
    return NextResponse.json({ error: 'Invalid API key format' }, { status: 401 });
  }

  const keyHash = hashApiKey(rawKey);
  const prefix = rawKey.slice(0, PREFIX_LENGTH);

  // Service client: API key auth runs before user context is established; must look up and validate keys directly. Accesses: api_keys.
  const supabase = createServiceClient();

  // Look up by prefix (indexed), then pick the row whose hash matches. The stored
  // prefix keeps two random characters, so unrelated keys can share it.
  const { data: rows, error } = await supabase
    .from('api_keys')
    .select(
      'id, workspace_id, org_id, user_id, key_hash, scopes, environment, expires_at, revoked_at, rate_limit_per_minute, realtime_enabled',
    )
    .eq('key_prefix', prefix);

  if (error) {
    return NextResponse.json(
      { error: 'API key check is unavailable; retry shortly' },
      { status: 503, headers: { 'Retry-After': '1' } },
    );
  }

  const keyRow = (rows ?? []).find(
    (row) =>
      row.key_hash.length === keyHash.length &&
      timingSafeEqual(Buffer.from(row.key_hash), Buffer.from(keyHash)),
  );
  if (!keyRow) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }

  // Check if revoked
  if (keyRow.revoked_at) {
    return NextResponse.json({ error: 'API key has been revoked' }, { status: 401 });
  }

  // Check expiration
  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'API key has expired' }, { status: 401 });
  }

  // Enforce per-key rate limit
  const rateLimit = keyRow.rate_limit_per_minute ?? 60;
  const rl = await checkRateLimit(`apikey:${keyRow.id}`, rateLimit, 60_000);
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000);
    return NextResponse.json(
      { error: 'API key rate limit exceeded' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(rateLimit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(rl.resetAt.getTime() / 1000)),
        },
      },
    );
  }

  // Update last_used_at (fire-and-forget, non-critical)
  void supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyRow.id)
    .then(({ error }) => {
      if (error)
        console.warn(`Failed to update api_key last_used_at for key ${keyRow.id}:`, error.message);
    });

  return {
    keyId: keyRow.id,
    workspaceId: keyRow.workspace_id,
    orgId: keyRow.org_id ?? null,
    userId: keyRow.user_id,
    scopes: keyRow.scopes as ApiKeyScope[],
    environment: keyRow.environment as 'live' | 'test',
    realtimeEnabled: !!keyRow.realtime_enabled,
  };
}

/**
 * Check if an API key context has the required scope.
 */
export function hasScope(ctx: ApiKeyContext, required: ApiKeyScope): boolean {
  // 'admin' scope includes all
  if (ctx.scopes.includes('admin')) return true;
  // 'write' scope includes 'read'
  if (required === 'read' && ctx.scopes.includes('write')) return true;
  return ctx.scopes.includes(required);
}

/**
 * Require a specific scope. Returns NextResponse 403 if insufficient.
 */
export function requireScope(ctx: ApiKeyContext, required: ApiKeyScope): NextResponse | null {
  if (!hasScope(ctx, required)) {
    return NextResponse.json(
      { error: `Insufficient scope. Required: ${required}` },
      { status: 403 },
    );
  }
  return null;
}
