import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { cachedJson } from '@/lib/api-cache';
import { requirePlatformOwner } from '@/lib/permissions';
import { applyRateLimit, RATE_AI } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

export interface MonthlyCost {
  month: string; // YYYY-MM
  amount: number;
}

export interface CreditsData {
  max: {
    plan: string;
    monthlyUsd: number;
    resetDay: number;
    daysUntilReset: number;
    status: 'active' | 'unknown';
    note: string;
  };
  api: {
    status: 'ok' | 'exhausted' | 'unknown';
    monthlySpend: number;
    monthlyBudget: number;
    pctUsed: number | null;
    dailyCosts: { date: string; amount: number }[];
    note: string;
  };
  historical: {
    totalSpend: number;
    months: MonthlyCost[];
  };
  org: {
    id: string;
    name: string;
  };
}

const ADMIN_API_BASE = 'https://api.anthropic.com/v1/organizations';

async function fetchAnthropicAdmin<T>(path: string, apiKey: string): Promise<T | null> {
  try {
    const res = await fetch(`${ADMIN_API_BASE}${path}`, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'analytics.cost.credits.get', RATE_AI);
  if (rateLimitResult) return rateLimitResult.blocked;

  const authResult = await requirePlatformOwner(request);
  if (authResult instanceof NextResponse) return authResult;

  // Anthropic API credit data is platform-owner-only.
  // Non-platform-owners get zeroed-out response — they don't share the org's API key.
  if (!authResult.resolved.isPlatformOwner) {
    return cachedJson({
      max: {
        plan: 'N/A',
        monthlyUsd: 0,
        resetDay: 1,
        daysUntilReset: 0,
        status: 'unknown' as const,
        note: 'Not available for this account',
      },
      api: {
        status: 'unknown' as const,
        monthlySpend: 0,
        monthlyBudget: 0,
        pctUsed: null,
        dailyCosts: [],
        note: 'Not available for this account',
      },
      historical: { totalSpend: 0, months: [] },
      org: { id: '', name: '' },
    });
  }

  const adminKey = process.env.ANTHROPIC_ADMIN_API_KEY;
  const resetDay = parseInt(process.env.CLAUDE_MAX_RESET_DAY ?? '1', 10);
  const monthlyBudget = 50; // soft budget cap

  // Calculate days until reset
  const now = new Date();
  let nextReset = new Date(now.getFullYear(), now.getMonth(), resetDay);
  if (now >= nextReset) {
    nextReset = new Date(now.getFullYear(), now.getMonth() + 1, resetDay);
  }
  const daysUntilReset = Math.ceil((nextReset.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const resetLabel = nextReset.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Default response
  const result: CreditsData = {
    max: {
      plan: 'Claude Max 20x',
      monthlyUsd: 200,
      resetDay,
      daysUntilReset,
      status: 'active',
      note: `Resets in ${daysUntilReset} days (${resetLabel})`,
    },
    api: {
      status: 'unknown',
      monthlySpend: 0,
      monthlyBudget,
      pctUsed: null,
      dailyCosts: [],
      note: 'API key not configured',
    },
    historical: {
      totalSpend: 0,
      months: [],
    },
    org: {
      id: '',
      name: 'Unknown',
    },
  };

  if (!adminKey) {
    return cachedJson(result);
  }

  // Fetch org info
  const orgData = await fetchAnthropicAdmin<{ id: string; name: string }>('/me', adminKey);
  if (orgData) {
    result.org = { id: orgData.id, name: orgData.name };
  }

  // Fetch cost report for current billing period
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const startingAt = monthStart.toISOString().split('T')[0];
  const endingAt = tomorrow.toISOString().split('T')[0];

  interface CostBucket {
    starting_at: string;
    ending_at: string;
    results: { cost_usd: string; line_item: string }[];
  }

  const costData = await fetchAnthropicAdmin<{
    data?: CostBucket[];
    has_more?: boolean;
    next_page?: string;
  }>(`/cost_report?starting_at=${startingAt}&ending_at=${endingAt}&bucket_width=1d`, adminKey);

  if (costData?.data) {
    const dailyCosts = costData.data.map((bucket) => ({
      date: bucket.starting_at.split('T')[0],
      amount: bucket.results.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0),
    }));
    const monthlySpend = dailyCosts.reduce((s, d) => s + d.amount, 0);
    const pctUsed = monthlyBudget > 0 ? Math.round((monthlySpend / monthlyBudget) * 100) : null;

    result.api = {
      status: monthlySpend >= monthlyBudget ? 'exhausted' : 'ok',
      monthlySpend,
      monthlyBudget,
      pctUsed,
      dailyCosts,
      note: `$${monthlySpend.toFixed(2)} / $${monthlyBudget} budget (${pctUsed ?? '?'}%)`,
    };
  } else {
    result.api.note = 'Cost data unavailable';
  }

  // Fetch historical cost data — go back up to 12 months, one request per month
  // Cost API supports max 31 daily buckets, so we query month-by-month
  const months: MonthlyCost[] = [];
  const historicalStart = new Date(now.getFullYear() - 1, now.getMonth(), 1); // 12 months ago

  for (
    let m = new Date(historicalStart);
    m <= monthStart;
    m = new Date(m.getFullYear(), m.getMonth() + 1, 1)
  ) {
    const mStart = m.toISOString().split('T')[0];
    const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 1).toISOString().split('T')[0];
    const monthKey = mStart.slice(0, 7); // YYYY-MM

    // Skip current month — already have it from the daily fetch above
    if (monthKey === startingAt.slice(0, 7)) {
      if (result.api.monthlySpend > 0) {
        months.push({ month: monthKey, amount: result.api.monthlySpend });
      }
      continue;
    }

    const mCost = await fetchAnthropicAdmin<{
      data?: CostBucket[];
    }>(`/cost_report?starting_at=${mStart}&ending_at=${mEnd}&bucket_width=1d`, adminKey!);

    const total = (mCost?.data ?? []).reduce(
      (s, bucket) => s + bucket.results.reduce((rs, r) => rs + (Number(r.cost_usd) || 0), 0),
      0,
    );
    if (total > 0) {
      months.push({ month: monthKey, amount: total });
    }
  }

  months.sort((a, b) => a.month.localeCompare(b.month));
  result.historical = {
    totalSpend: months.reduce((s, m) => s + m.amount, 0),
    months,
  };

  return cachedJson(result);
}
