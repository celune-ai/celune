/**
 * Plans: `cloud` (paid per seat), `enterprise` (set by hand, contact sales), and
 * `platform_owner`. `unpaid` is a resolved state, never stored: the org has no
 * active Cloud subscription and is sent to checkout.
 */
export type Plan = 'cloud' | 'enterprise' | 'platform_owner' | 'unpaid';

/** Plan names from before the Cloud plan; any of them read from a row resolves to `cloud`. */
export const LEGACY_PLAN_NAMES = ['builder', 'pro', 'unlimited', 'team', 'build', 'free'] as const;

/** Resolve a stored or legacy plan name to a current plan. Unknown and legacy names are `cloud`. */
export function normalizePlan(raw: string | null | undefined): Plan {
  if (raw === 'enterprise' || raw === 'platform_owner' || raw === 'unpaid') return raw;
  return 'cloud';
}

export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing';

export type BillingInterval = 'month' | 'year';

export interface Subscription {
  id: string;
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: Plan;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  seats: number | null;
  billing_interval: BillingInterval | null;
  created_at: string;
  updated_at: string;
}

/** v2 usage summary returned by /api/billing/usage */
export interface UsageV2Summary {
  event_type: string;
  label: string;
  total: number;
  period_start: string;
  period_end: string;
}

export const PLAN_LABELS: Record<Plan, string> = {
  cloud: 'Celune Cloud',
  enterprise: 'Enterprise',
  platform_owner: 'Platform Owner',
  unpaid: 'No plan',
};

/** Cloud list price per seat per month, in USD. */
export const CLOUD_SEAT_PRICE_USD: Record<BillingInterval, number> = {
  month: 25,
  year: 20,
};

export const PLAN_PRICES: Record<Plan, string> = {
  cloud: '$25/seat/mo',
  enterprise: 'Custom',
  platform_owner: 'Included',
  unpaid: '',
};
