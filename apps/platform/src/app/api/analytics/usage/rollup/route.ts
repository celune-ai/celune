import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { usageRollupSchema } from '@/lib/schemas/onboarding.schema';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

/**
 * POST /api/analytics/usage/rollup
 * Triggers aggregation of usage_events into usage_summaries.
 * Owner/admin only. Can be called via cron or manually.
 *
 * Body (optional):
 *   period_type - 'daily' | 'monthly' (default: runs both)
 *   lookback_days - number of days to re-aggregate (default: 2)
 */
type UsageRollupBody = z.infer<typeof usageRollupSchema>;

export const POST = withApiSecurity<UsageRollupBody>(
  async (_request: NextRequest, { body }: SecurityContext<UsageRollupBody>) => {
    const periodType = body.period_type;
    const lookbackDays = body.lookback_days ?? 2;

    // Service client: runs cross-workspace usage aggregation RPC that requires unrestricted access. Accesses: usage_events, usage_summaries (via RPC).
    const supabase = createServiceClient();
    const results: { period: string; rows: number }[] = [];

    const periods = periodType ? [periodType] : ['daily', 'monthly'];

    for (const period of periods) {
      const { data, error } = await supabase.rpc('rollup_usage_summaries', {
        p_period_type: period,
        p_lookback_days: lookbackDays,
      });
      if (error) throw error;
      results.push({ period, rows: data ?? 0 });
    }

    return NextResponse.json({ ok: true, results });
  },
  {
    platformOwner: true,
    rateLimit: { tier: RATE_WRITE, routeKey: 'analytics.usage.rollup.post' },
    parseBody: usageRollupSchema,
  },
);
