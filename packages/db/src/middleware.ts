import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Cookie domain shared across the host's subdomains: NEXT_PUBLIC_COOKIE_DOMAIN, else the
 * parent of NEXT_PUBLIC_APP_DOMAIN (app.example.com -> .example.com). Applied only when the
 * request host is under it, so localhost and previews keep host-only cookies.
 */
function sharedCookieDomain(hostname: string): string | undefined {
  const explicit = process.env.NEXT_PUBLIC_COOKIE_DOMAIN?.trim();
  const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN?.trim();
  let domain = explicit || undefined;
  if (!domain && appDomain) {
    const labels = appDomain.split(':')[0]!.split('.').filter(Boolean);
    if (labels.length >= 3) domain = `.${labels.slice(1).join('.')}`;
  }
  return domain && hostname.endsWith(domain) ? domain : undefined;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          const cookieDomain = sharedCookieDomain(request.nextUrl.hostname);
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...options,
              ...(cookieDomain && { domain: cookieDomain }),
            }),
          );
        },
      },
    },
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  // If the refresh token is invalid/expired, clear auth cookies to prevent
  // the browser client from retrying in an infinite 429 loop
  if (error && !user) {
    const cookieDomain = sharedCookieDomain(request.nextUrl.hostname);
    const authCookies = request.cookies.getAll().filter((c) => c.name.startsWith('sb-'));
    if (authCookies.length > 0) {
      supabaseResponse = NextResponse.next({ request });
      for (const cookie of authCookies) {
        supabaseResponse.cookies.set(cookie.name, '', {
          maxAge: 0,
          path: '/',
          ...(cookieDomain && { domain: cookieDomain }),
        });
      }
    }
  }

  return { user, response: supabaseResponse };
}

/**
 * Verifies the Supabase session from request cookies without refreshing tokens.
 * Use this for API route authentication where cookie mutation is not needed.
 * Returns the user ID string, or null if unauthenticated.
 */
export async function getSessionUserId(request: NextRequest): Promise<string | null> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {
          // No-op: read-only session check
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}
