import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { applyRateLimit, RATE_AUTH } from '@/lib/rate-limiter';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { generateApiKey } from '@/lib/api-keys';
import { createServiceClient } from '@repo/db/service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/device/token
 *
 * Device Authorization Flow — Step 3.
 * CLI polls this endpoint with the device_code. Returns an API key
 * once the user has authorized in the browser.
 */
const tokenSchema = z.object({
  device_code: z.string().min(1).max(200),
});

export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'auth.device-token', RATE_AUTH);
  if (rateLimitResult) return rateLimitResult.blocked;

  const parsed = await parseBody(request, tokenSchema);
  if (isErrorResponse(parsed)) return parsed;

  const supabase = createServiceClient();

  // Look up device code
  const { data: deviceAuth, error: lookupError } = await supabase
    .from('device_auth_codes')
    .select('id, user_id, workspace_id, status, expires_at')
    .eq('device_code', parsed.device_code)
    .single();

  if (lookupError || !deviceAuth) {
    return NextResponse.json({ error: 'invalid_device_code' }, { status: 404 });
  }

  // Check expiry
  if (new Date(deviceAuth.expires_at) < new Date()) {
    if (deviceAuth.status === 'pending' || deviceAuth.status === 'authorized') {
      await supabase
        .from('device_auth_codes')
        .update({ status: 'expired' })
        .eq('id', deviceAuth.id);
    }
    return NextResponse.json({ error: 'expired_token' }, { status: 410 });
  }

  // Still waiting for user to authorize
  if (deviceAuth.status === 'pending') {
    return NextResponse.json({ error: 'authorization_pending' }, { status: 428 });
  }

  // Already consumed
  if (deviceAuth.status === 'used') {
    return NextResponse.json({ error: 'token_already_used' }, { status: 409 });
  }

  if (deviceAuth.status === 'expired') {
    return NextResponse.json({ error: 'expired_token' }, { status: 410 });
  }

  // Status is 'authorized' — issue the API key
  // CAS: mark as used before creating key (prevent double-issuance)
  const { data: updated, error: updateError } = await supabase
    .from('device_auth_codes')
    .update({ status: 'used', used_at: new Date().toISOString() })
    .eq('id', deviceAuth.id)
    .eq('status', 'authorized')
    .select('id')
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ error: 'token_already_used' }, { status: 409 });
  }

  // Generate API key
  const { key, hash, prefix } = generateApiKey('live');

  // Look up workspace name and user email
  const [{ data: workspace }, { data: authUser }] = await Promise.all([
    supabase.from('workspaces').select('name').eq('id', deviceAuth.workspace_id!).single(),
    supabase.auth.admin.getUserById(deviceAuth.user_id!),
  ]);

  const { error: keyError } = await supabase.from('api_keys').insert({
    workspace_id: deviceAuth.workspace_id,
    user_id: deviceAuth.user_id,
    name: `CLI (${new Date().toLocaleDateString()})`,
    key_hash: hash,
    key_prefix: prefix,
    environment: 'live',
    scopes: ['write'],
    rate_limit_per_minute: 100,
    realtime_enabled: true,
  });

  if (keyError) {
    return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 });
  }

  return NextResponse.json({
    api_key: key,
    workspace_id: deviceAuth.workspace_id,
    workspace_name: workspace?.name ?? '',
    user_id: deviceAuth.user_id,
    email: authUser?.user?.email ?? '',
  });
}
