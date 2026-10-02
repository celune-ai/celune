import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { applyRateLimit, RATE_AUTH } from '@/lib/rate-limiter';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { safeErrorResponse } from '@/lib/api-error';
import { cliTokenSchema } from '@/lib/schemas/auth.schema';

/**
 * POST /api/auth/cli-token
 *
 * CLI token exchange endpoint. Accepts a Supabase access_token,
 * validates it against Supabase Auth, and returns the validated
 * user info. The CLI can then use this token as a Bearer token
 * for subsequent API requests (with X-Celune-CLI header).
 *
 * This endpoint intentionally skips CSRF origin validation since
 * CLI requests originate from localhost without a browser origin.
 * Rate limiting (RATE_AUTH: 5 req/min) provides brute-force protection.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Rate limit by IP (no auth yet, so IP-based)
    const rateLimitResult = await applyRateLimit(req, 'auth.cli-token', RATE_AUTH, false);
    if (rateLimitResult) return rateLimitResult.blocked;

    // 2. Parse and validate body
    const parsed = await parseBody(req, cliTokenSchema);
    if (isErrorResponse(parsed)) return parsed;

    const { access_token } = parsed;

    // 3. Validate token with Supabase (service client can verify any user token)
    const supabase = createServiceClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(access_token);

    if (error || !user) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    // 4. Return validated user info (token not echoed — client already has it)
    return NextResponse.json({
      user_id: user.id,
      email: user.email,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
