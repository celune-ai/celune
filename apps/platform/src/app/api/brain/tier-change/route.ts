import { type NextRequest, NextResponse } from 'next/server';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity } from '@/lib/api-security';

export const dynamic = 'force-dynamic';

/**
 * POST /api/brain/tier-change
 *
 * DEPRECATED: Tier gating has been removed — all users get the full brain.
 * This endpoint is retained for backwards compatibility but performs no action.
 * Returns 410 Gone to signal clients to stop calling it.
 */
export const POST = withApiSecurity(
  async () => {
    return NextResponse.json(
      {
        error: 'Tier gating has been removed. All users receive the full brain.',
        deprecated: true,
      },
      { status: 410 },
    );
  },
  {
    rateLimit: { tier: RATE_WRITE, routeKey: 'brain.tier-change.post' },
  },
);
