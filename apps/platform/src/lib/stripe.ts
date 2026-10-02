import Stripe from 'stripe';
import { PLAN_TIERS, normalizePlan } from '@repo/types';
import type { BillingInterval, Plan, PlanLimits } from '@repo/types';
import { resolveHostConfig } from '@celuneai/core/config';

let _stripe: Stripe | null = null;

/**
 * Get a lazy-initialized Stripe client.
 * Returns null if STRIPE_SECRET_KEY is not configured or the host runs the
 * community edition, which has no billing.
 */
export function getStripe(): Stripe | null {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (resolveHostConfig(process.env).edition === 'community') return null;
  if (!_stripe) {
    // Pinned so an SDK upgrade cannot change the API version silently; keep it equal to the webhook endpoint's version.
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-08-26.dahlia',
      typescript: true,
    });
  }
  return _stripe;
}

/** The Cloud per-seat price for a billing interval, or '' when unset. */
export function cloudPriceId(interval: BillingInterval): string {
  const id =
    interval === 'year'
      ? process.env.STRIPE_PRICE_CLOUD_ANNUAL
      : process.env.STRIPE_PRICE_CLOUD_MONTHLY;
  return id ?? '';
}

/** Price ids from before the Cloud plan; subscriptions on them are Cloud subscriptions. */
function legacyPriceIds(): string[] {
  return [
    process.env.STRIPE_PRICE_PRO,
    process.env.STRIPE_PRICE_UNLIMITED,
    process.env.STRIPE_PRICE_TEAM,
    process.env.STRIPE_PRICE_BUILD,
  ].filter((id): id is string => Boolean(id));
}

/**
 * Map a Stripe price ID to a plan. Enterprise is set by hand and never billed
 * through Stripe, so the Cloud prices and the legacy prices map to cloud. An
 * unknown price grants nothing: it returns null and is logged.
 */
export function priceIdToPlan(priceId: string): Plan | null {
  const known = [cloudPriceId('month'), cloudPriceId('year'), ...legacyPriceIds()];
  if (priceId && known.includes(priceId)) return 'cloud';
  console.error('[stripe] Unrecognized price id; granting no plan:', priceId || '(none)');
  return null;
}

/** Limits for a plan name; legacy and unknown names get the Cloud limits (none). */
export function getPlanLimits(planKey: string): PlanLimits {
  return PLAN_TIERS[normalizePlan(planKey)] ?? PLAN_TIERS.cloud;
}
