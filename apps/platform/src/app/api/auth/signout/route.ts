import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { applyRateLimit, RATE_AUTH } from '@/lib/rate-limiter';
import { validateOrigin } from '@/lib/csrf';
import { logSecurityEvent } from '@/lib/security-audit';

export async function POST(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;

  const rateLimitResult = await applyRateLimit(request, 'auth.signout', RATE_AUTH, false);
  if (rateLimitResult) return rateLimitResult.blocked;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.auth.signOut();

  if (user) {
    logSecurityEvent(
      {
        event_type: 'auth.logout',
        severity: 'info',
        actor_id: user.id,
        actor_email: user.email ?? null,
      },
      request,
    );
  }

  return NextResponse.json({ success: true });
}
