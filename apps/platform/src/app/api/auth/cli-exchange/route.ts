import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { applyRateLimit, RATE_AUTH } from '@/lib/rate-limiter';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { generateApiKey } from '@/lib/api-keys';
import { createServiceClient } from '@repo/db/service';

export const dynamic = 'force-dynamic';

// POST: Exchange a one-time setup code for an API key (called from CLI)
// No auth required — the code IS the auth. This is the whole point.
const exchangeSchema = z.object({
  code: z.string().min(1).max(100),
});

export async function POST(request: NextRequest) {
  // No CSRF check — this is called from the CLI, not a browser
  const rateLimitResult = await applyRateLimit(request, 'auth.cli-exchange', RATE_AUTH);
  if (rateLimitResult) return rateLimitResult.blocked;

  const parsed = await parseBody(request, exchangeSchema);
  if (isErrorResponse(parsed)) return parsed;

  const supabase = createServiceClient();

  // Look up the code — must exist, not used, not expired
  const { data: token, error: lookupError } = await supabase
    .from('cli_setup_tokens')
    .select('id, user_id, workspace_id, expires_at, used_at')
    .eq('code', parsed.code)
    .is('used_at', null)
    .single();

  if (lookupError || !token) {
    return NextResponse.json(
      { error: 'Invalid or expired setup code. Run the setup command again to get a new one.' },
      { status: 401 },
    );
  }

  // Check expiry
  if (new Date(token.expires_at) < new Date()) {
    // Mark as used so it can't be retried
    await supabase
      .from('cli_setup_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', token.id);

    return NextResponse.json(
      { error: 'Setup code expired. Run the setup command again to get a new one.' },
      { status: 401 },
    );
  }

  // Mark as used BEFORE creating the key (prevent race condition)
  // CAS: use .select().single() to verify exactly one row was updated
  const { data: updated, error: updateError } = await supabase
    .from('cli_setup_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', token.id)
    .is('used_at', null)
    .select('id')
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ error: 'Setup code already used.' }, { status: 409 });
  }

  // Create an API key for this user/workspace
  const { key, hash, prefix } = generateApiKey('live');

  // Look up workspace name and user email for CLI config
  const [{ data: workspace }, { data: userData }] = await Promise.all([
    supabase.from('workspaces').select('name').eq('id', token.workspace_id).single(),
    supabase
      .from('auth.users')
      .select('email')
      .eq('id', token.user_id)
      .single()
      .then(
        (r) => r,
        // auth.users may not be accessible via PostgREST — fall back
        () => ({ data: null }),
      ),
  ]);

  // Resolve email from user metadata if PostgREST can't query auth.users
  let email = userData?.email ?? '';
  if (!email) {
    const { data: authUser } = await supabase.auth.admin.getUserById(token.user_id);
    email = authUser?.user?.email ?? '';
  }

  const { error: keyError } = await supabase.from('api_keys').insert({
    workspace_id: token.workspace_id,
    user_id: token.user_id,
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
    workspace_id: token.workspace_id,
    workspace_name: workspace?.name ?? '',
    user_id: token.user_id,
    email,
  });
}
