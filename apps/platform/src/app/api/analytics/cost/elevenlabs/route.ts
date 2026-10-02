import { NextRequest, NextResponse } from 'next/server';
import { getSubscription, getUsageStats } from '@/lib/elevenlabs';
import { cachedJson } from '@/lib/api-cache';
import { requirePlatformOwner } from '@/lib/permissions';
import { applyRateLimit, RATE_AI } from '@/lib/rate-limiter';
import type { ElevenLabsSubscription } from '@repo/types';

export const dynamic = 'force-dynamic';

export interface ElevenLabsDailyUsage {
  day: string;
  characters: number;
}

export interface ElevenLabsAnalyticsData {
  subscription: ElevenLabsSubscription;
  daily: ElevenLabsDailyUsage[];
}

export async function GET(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'analytics.cost.elevenlabs.get', RATE_AI);
  if (rateLimitResult) return rateLimitResult.blocked;

  const authResult = await requirePlatformOwner(request);
  if (authResult instanceof NextResponse) return authResult;

  const days = parseInt(request.nextUrl.searchParams.get('days') ?? '30', 10);

  const now = Math.floor(Date.now() / 1000);
  const startUnix = now - days * 86400;

  try {
    const [subscription, usage] = await Promise.all([
      getSubscription(),
      getUsageStats(startUnix, now),
    ]);

    // Transform time-series into { day, characters }[]
    const daily: ElevenLabsDailyUsage[] = (usage.time ?? []).map((ts, i) => {
      const date = new Date(ts * 1000);
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      // Sum all voice usages for this time bucket
      const characters = Object.values(usage.usage).reduce((sum, arr) => sum + (arr[i] ?? 0), 0);
      return { day, characters };
    });

    return cachedJson({ subscription, daily } satisfies ElevenLabsAnalyticsData);
  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch ElevenLabs data' }, { status: 502 });
  }
}
