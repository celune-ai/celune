import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { validateOrigin } from '@/lib/csrf';
import { safeErrorResponse } from '@/lib/api-error';
import { z } from 'zod';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

// GET /api/user/sessions — returns current session info + login history
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    // Fetch login history from activity_log where event_type = 'login' for this user
    const { data: loginHistory } = await supabase
      .from('activity_log')
      .select('id, event_type, source, title, details, created_at')
      .eq('user_id', user.id)
      .eq('event_type', 'login')
      .order('created_at', { ascending: false })
      .limit(20);

    return NextResponse.json({
      currentSession: session
        ? {
            accessToken: session.access_token ? '[present]' : null,
            expiresAt: session.expires_at,
            userId: user.id,
            email: user.email,
            lastSignIn: user.last_sign_in_at,
          }
        : null,
      loginHistory: loginHistory ?? [],
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

// POST /api/user/sessions — log a sign-in event to activity_log
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'user.sessions.log', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const raw = await request.json().catch(() => ({}));
    const body = z.object({ provider: z.string().default('email') }).parse(raw);
    const provider = body.provider;
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

    const { createServiceClient } = await import('@repo/db/service');
    const serviceClient = createServiceClient();
    await serviceClient.from('activity_log').insert({
      event_type: 'login',
      severity: 'info',
      source: 'auth',
      title: `Signed in via ${provider}`,
      user_id: user.id,
      actor_user_id: user.id,
      ip_address: ip,
      details: {
        provider,
        email: user.email,
        user_agent: request.headers.get('user-agent') ?? undefined,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

// DELETE /api/user/sessions — sign out other sessions (scope=others) or all (scope=global)
export async function DELETE(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'user.sessions.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope') === 'global' ? 'global' : 'others';

    const { error } = await supabase.auth.signOut({ scope });
    if (error) throw error;

    return NextResponse.json({ success: true, scope });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
