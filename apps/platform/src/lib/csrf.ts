import { NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { URL_MARKETING, URL_APP, DOMAIN_MARKETING } from '@/lib/branding';

// In-memory rate limit for CLI token validation to prevent brute-force
const CLI_RATE_LIMIT = { maxAttempts: 10, windowMs: 60_000 };
const cliRateLimitStore = new Map<string, { count: number; windowStart: number }>();

function checkCliRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = cliRateLimitStore.get(ip);
  if (!entry || now - entry.windowStart >= CLI_RATE_LIMIT.windowMs) {
    cliRateLimitStore.set(ip, { count: 1, windowStart: now });
    return true;
  }
  entry.count += 1;
  return entry.count <= CLI_RATE_LIMIT.maxAttempts;
}

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3002',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3002',
  'http://[::1]:3000',
  'http://[::1]:3002',
];

const ALLOWED_ORIGINS =
  process.env.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()) ?? [
        URL_MARKETING,
        `https://www.${DOMAIN_MARKETING}`,
        URL_APP,
      ])
    : DEV_ORIGINS;

/**
 * Checks if a request is an authenticated CLI request.
 *
 * CLI requests must include both:
 *   - `X-Celune-CLI: true` header
 *   - `Authorization: Bearer <token>` header with a valid Supabase token
 *
 * Returns the user ID if valid, or null if not a CLI request / invalid token.
 */
async function validateCliToken(request: Request): Promise<string | null> {
  const cliHeader = request.headers.get('x-celune-cli');
  if (cliHeader !== 'true') return null;

  // Rate limit CLI token validation to prevent brute-force
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';
  if (!checkCliRateLimit(ip)) return null;

  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  if (!token) return null;

  try {
    const supabase = createServiceClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) return null;
    return user.id;
  } catch {
    return null;
  }
}

/**
 * Validates the Origin or Referer header of a mutating request.
 * Returns a 403 NextResponse if the origin is not in the allowed list,
 * or null if the request is allowed to proceed.
 *
 * Also allows:
 *   - Railway preview deployments (*.up.railway.app)
 *   - Requests where the Host header matches the Origin (same-origin)
 *   - Authenticated CLI requests (X-Celune-CLI + Bearer token)
 */
export async function validateOrigin(request: Request): Promise<NextResponse | null> {
  // CLI bypass: skip origin check for authenticated CLI requests
  const cliUserId = await validateCliToken(request);
  if (cliUserId) {
    // Attach user ID for downstream route handlers via headers.
    // Note: Request headers are immutable in the Fetch API, so downstream
    // routes should check the CLI token directly or use getAuthUserId().
    return null;
  }
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('host');

  const candidate = origin ?? (referer ? new URL(referer).origin : null);

  if (!candidate) {
    return NextResponse.json({ error: 'Forbidden: missing origin' }, { status: 403 });
  }

  // Exact match against allowed list
  if (ALLOWED_ORIGINS.includes(candidate)) return null;

  // Same-origin check: Origin host matches the Host header
  try {
    const originHost = new URL(candidate).host;
    if (host && originHost === host) return null;
  } catch {
    // invalid URL, fall through to reject
  }

  // Allow Railway preview deployments — scoped to our known project IDs
  try {
    const hostname = new URL(candidate).hostname;
    if (hostname.endsWith('.up.railway.app')) {
      const RAILWAY_PROJECT_IDS = ['0rybv8w4', 'dnzy2ol9', 'tudk3kce', '6iddkdxt', 'rhdjaz0d'];
      if (RAILWAY_PROJECT_IDS.some((id) => hostname.startsWith(id))) {
        return null;
      }
    }
  } catch {
    // invalid URL, fall through to reject
  }

  return NextResponse.json({ error: 'Forbidden: origin not allowed' }, { status: 403 });
}
