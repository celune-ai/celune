import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePlatformOwner } from '@/lib/permissions';
import { cachedJson } from '@/lib/api-cache';

export const dynamic = 'force-dynamic';

// ─── Static subscription catalog ─────────────────────────────────────────────
// Update these values when plans change. Monthly cost in USD.

export interface Subscription {
  id: string;
  name: string;
  category: 'infra' | 'ai' | 'tools' | 'domains';
  monthlyUsd: number;
  billingCycle: 'monthly' | 'annual';
  /** Annual cost if billed yearly (monthlyUsd * 12 if not set) */
  annualUsd?: number;
  url?: string;
  notes?: string;
}

const SUBSCRIPTIONS: Subscription[] = [
  // ── Infrastructure ──
  {
    id: 'vercel-pro',
    name: 'Vercel Pro',
    category: 'infra',
    monthlyUsd: 20,
    billingCycle: 'monthly',
    url: 'https://vercel.com',
    notes: 'Hosting for web, admin, docs apps',
  },
  {
    id: 'supabase-pro',
    name: 'Supabase Pro',
    category: 'infra',
    monthlyUsd: 25,
    billingCycle: 'monthly',
    url: 'https://supabase.com',
    notes: 'Database, auth, storage, edge functions',
  },
  // ── AI ──
  {
    id: 'claude-max',
    name: 'Claude Max 20x',
    category: 'ai',
    monthlyUsd: 200,
    billingCycle: 'monthly',
    url: 'https://claude.ai',
    notes: 'Claude.ai Max 20x subscription — includes Claude Code usage',
  },
  {
    id: 'anthropic-api',
    name: 'Anthropic API',
    category: 'ai',
    monthlyUsd: 0,
    billingCycle: 'monthly',
    url: 'https://console.anthropic.com',
    notes: 'Pay-as-you-go Claude API usage (see API Costs section)',
  },
  // ── Tools ──
  {
    id: 'github-pro',
    name: 'GitHub',
    category: 'tools',
    monthlyUsd: 0,
    billingCycle: 'monthly',
    url: 'https://github.com',
    notes: 'Free tier',
  },
];

export async function GET(request: NextRequest) {
  // RBAC: require analytics:read permission
  const permResult = await requirePlatformOwner(request);
  if (permResult instanceof NextResponse) return permResult;

  // Platform subscription data is only visible to the platform owner.
  // Other users see empty subscriptions — they have their own billing via Stripe.
  if (!permResult.resolved.isPlatformOwner) {
    return cachedJson({
      subscriptions: [],
      totalMonthlyUsd: 0,
      byCategory: {},
    });
  }

  const totalMonthly = SUBSCRIPTIONS.reduce((sum, s) => sum + s.monthlyUsd, 0);

  const byCategory = SUBSCRIPTIONS.reduce<Record<string, number>>((acc, s) => {
    acc[s.category] = (acc[s.category] ?? 0) + s.monthlyUsd;
    return acc;
  }, {});

  return cachedJson({
    subscriptions: SUBSCRIPTIONS,
    totalMonthlyUsd: totalMonthly,
    byCategory,
  });
}
