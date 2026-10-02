import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_AUTH } from '@/lib/rate-limiter';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { createClient } from '@repo/db/server';
import { createServiceClient } from '@repo/db/service';
import { requireWorkspaceMembership } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

// POST: Create a one-time setup code (called from onboarding UI)
// This is under /api/auth/ which is public in middleware, so we
// authenticate via Supabase session cookie directly.
const createSchema = z.object({
  workspace_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;

  const rateLimitResult = await applyRateLimit(request, 'auth.cli-setup', RATE_AUTH);
  if (rateLimitResult) return rateLimitResult.blocked;

  const parsed = await parseBody(request, createSchema);
  if (isErrorResponse(parsed)) return parsed;

  // Authenticate via session cookie (middleware doesn't inject x-user-id for /api/auth/)
  const supabaseAuth = await createClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const userId = user.id;

  // Verify user is a member of the requested workspace
  const membershipError = await requireWorkspaceMembership(userId, parsed.workspace_id);
  if (membershipError) return membershipError;

  // Generate a short, readable code (128-bit entropy)
  const code = `celune_setup_${randomBytes(16).toString('hex')}`;

  const supabase = createServiceClient();

  // Clean up any existing unused tokens for this user/workspace
  await supabase
    .from('cli_setup_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('workspace_id', parsed.workspace_id)
    .is('used_at', null);

  // Create new token (5 min expiry)
  const { error } = await supabase.from('cli_setup_tokens').insert({
    code,
    user_id: userId,
    workspace_id: parsed.workspace_id,
  });

  if (error) {
    return NextResponse.json({ error: 'Failed to create setup code' }, { status: 500 });
  }

  return NextResponse.json({ code, expires_in: 300 });
}
