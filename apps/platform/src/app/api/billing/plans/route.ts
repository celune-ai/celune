import { NextResponse } from 'next/server';
import { cloudPriceId } from '@/lib/stripe';
import { CLOUD_SEAT_PRICE_USD, PLAN_LABELS, PLAN_PRICES, PLAN_TIERS } from '@repo/types';
import type { PlanLimits } from '@repo/types';

export const dynamic = 'force-dynamic';

export interface PlanConfig {
  id: string;
  plan: 'cloud' | 'enterprise';
  display_name: string;
  description: string;
  /** Per seat per month, billed monthly. Null for Enterprise (custom). */
  price_monthly: number | null;
  /** Per seat per month, billed annually. Null for Enterprise (custom). */
  price_annual_monthly: number | null;
  price_formatted: string;
  currency: string;
  /** Monthly Cloud price id; empty when unset or for Enterprise. */
  stripe_price_id: string;
  /** Annual Cloud price id; empty when unset or for Enterprise. */
  stripe_price_id_annual: string;
  limits: PlanLimits;
  features: string[];
  highlight?: boolean;
}

/**
 * GET /api/billing/plans
 *
 * Returns the plans on offer: Celune Cloud (per seat, monthly or annual) and
 * Enterprise (contact sales, no self-serve checkout).
 */
export async function GET() {
  const plans: PlanConfig[] = [
    {
      id: 'cloud',
      plan: 'cloud',
      display_name: PLAN_LABELS.cloud,
      description: 'Per seat. Unlimited agents, workspaces, and memories. Bring your own keys.',
      price_monthly: CLOUD_SEAT_PRICE_USD.month,
      price_annual_monthly: CLOUD_SEAT_PRICE_USD.year,
      price_formatted: PLAN_PRICES.cloud,
      currency: 'usd',
      stripe_price_id: cloudPriceId('month'),
      stripe_price_id_annual: cloudPriceId('year'),
      limits: PLAN_TIERS.cloud,
      features: PLAN_TIERS.cloud.features,
      highlight: true,
    },
    {
      id: 'enterprise',
      plan: 'enterprise',
      display_name: PLAN_LABELS.enterprise,
      description: 'Custom terms or a dedicated contract. Contact sales.',
      price_monthly: null,
      price_annual_monthly: null,
      price_formatted: PLAN_PRICES.enterprise,
      currency: 'usd',
      stripe_price_id: '',
      stripe_price_id_annual: '',
      limits: PLAN_TIERS.enterprise,
      features: PLAN_TIERS.enterprise.features,
    },
  ];

  return NextResponse.json(plans, {
    headers: { 'Cache-Control': 'private, max-age=3600, stale-while-revalidate=30' },
  });
}
