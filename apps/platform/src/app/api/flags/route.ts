import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { evaluateAllFlags } from '@repo/db/feature-flags';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import type { FlagEvaluationContext } from '@repo/types';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

/**
 * GET /api/flags — Evaluate all enabled flags for the current user context.
 * Returns Record<string, boolean | string> — evaluated results only, never targeting rules.
 * Context is built server-side from auth — never from user-supplied params.
 */
export async function GET(request: NextRequest) {
  const rl = await applyRateLimit(request, 'flags', RATE_READ);
  if (rl) return rl.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Build context from server-side data — not from query params
    const supabase = createServiceClient();
    const { data: user } = await supabase.auth.admin.getUserById(userId);

    const isDev =
      process.env.NODE_ENV === 'development' ||
      process.env.NEXT_PUBLIC_APP_URL?.includes('localhost');

    const context: FlagEvaluationContext = {
      userId,
      email: user?.user?.email,
      environment: isDev ? 'development' : 'production',
    };

    const flags = await evaluateAllFlags(context);
    return NextResponse.json(flags);
  } catch {
    return NextResponse.json({}, { status: 200 }); // Fail open — empty flags
  }
}
