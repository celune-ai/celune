import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_AUTH } from '@/lib/rate-limiter';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { createClient } from '@repo/db/server';
import { createServiceClient } from '@repo/db/service';
import { requireWorkspaceMembership } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/device/verify
 *
 * Device Authorization Flow — Step 2.
 * Called from the browser (authenticated user). Binds the user_code to a
 * user + workspace, authorizing the CLI to receive an API key.
 */
const verifySchema = z.object({
  user_code: z
    .string()
    .min(1)
    .max(20)
    .transform((v) => v.toUpperCase().replace(/\s/g, '')),
  workspace_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;

  const rateLimitResult = await applyRateLimit(request, 'auth.device-verify', RATE_AUTH);
  if (rateLimitResult) return rateLimitResult.blocked;

  const parsed = await parseBody(request, verifySchema);
  if (isErrorResponse(parsed)) return parsed;

  // Authenticate via session cookie
  const supabaseAuth = await createClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Verify workspace membership
  const membershipError = await requireWorkspaceMembership(user.id, parsed.workspace_id);
  if (membershipError) return membershipError;

  const supabase = createServiceClient();

  // Look up the user code — must be pending and not expired
  const { data: deviceAuth, error: lookupError } = await supabase
    .from('device_auth_codes')
    .select('id, expires_at, status')
    .eq('user_code', parsed.user_code)
    .eq('status', 'pending')
    .single();

  if (lookupError || !deviceAuth) {
    return NextResponse.json(
      { error: 'Invalid or expired code. Check the code in your terminal and try again.' },
      { status: 404 },
    );
  }

  // Check expiry
  if (new Date(deviceAuth.expires_at) < new Date()) {
    await supabase.from('device_auth_codes').update({ status: 'expired' }).eq('id', deviceAuth.id);
    return NextResponse.json(
      { error: 'Code expired. Run the auth command again in your terminal.' },
      { status: 410 },
    );
  }

  // Authorize — CAS: only update if still pending
  const { data: updated, error: updateError } = await supabase
    .from('device_auth_codes')
    .update({
      status: 'authorized',
      user_id: user.id,
      workspace_id: parsed.workspace_id,
      authorized_at: new Date().toISOString(),
    })
    .eq('id', deviceAuth.id)
    .eq('status', 'pending')
    .select('id')
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ error: 'Code already used or expired.' }, { status: 409 });
  }

  return NextResponse.json({ success: true });
}
