import { createClient } from '@repo/db/server';
import { NextResponse, type NextRequest } from 'next/server';
import { logAuthSuccess, logAuthFailure } from '@/lib/security-audit';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ||
    `https://${request.headers.get('host')}` ||
    new URL(request.url).origin;
  const code = searchParams.get('code');
  const rawNext = searchParams.get('next') ?? '/';
  const decoded = decodeURIComponent(rawNext);
  const next = decoded.startsWith('/') && !decoded.startsWith('//') ? decoded : '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Store last auth provider in user metadata for the "Last used" badge
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.app_metadata?.provider && user.app_metadata.provider !== 'email') {
        await supabase.auth.updateUser({
          data: { last_auth_provider: user.app_metadata.provider },
        });
      }

      // Log login to security_audit_log + activity_log (fire-and-forget)
      if (user) {
        logAuthSuccess(user.id, user.email ?? undefined, request);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  logAuthFailure('auth-callback-failed', { had_code: !!code }, request);
  return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
}
