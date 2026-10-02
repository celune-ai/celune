import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { evaluateAllFlags } from '@repo/db/feature-flags';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

/** Flags that are safe to expose without authentication */
const PUBLIC_FLAG_KEYS = ['signup_gated', 'oauth_enabled'];

/**
 * GET /api/flags/public — Evaluate public flags (no auth required).
 * Only exposes flags in the PUBLIC_FLAG_KEYS allowlist.
 * Used by login/signup pages to check if signup is gated.
 */
export async function GET(request: NextRequest) {
  const rl = await applyRateLimit(request, 'flags.public', RATE_READ);
  if (rl) return rl.blocked;

  try {
    const isDev =
      process.env.NODE_ENV === 'development' ||
      process.env.NEXT_PUBLIC_APP_URL?.includes('localhost');

    const allFlags = await evaluateAllFlags({
      userId: 'anonymous',
      environment: isDev ? 'development' : 'production',
    });
    const publicFlags: Record<string, boolean | string> = {};
    for (const key of PUBLIC_FLAG_KEYS) {
      if (key in allFlags) {
        publicFlags[key] = allFlags[key];
      }
    }
    return NextResponse.json(publicFlags);
  } catch {
    return NextResponse.json({}, { status: 200 });
  }
}
