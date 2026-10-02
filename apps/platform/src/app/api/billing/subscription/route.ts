import { NextResponse } from 'next/server';
import { createClient } from '@repo/db/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { hasAccess } from '@/lib/plan-enforcement';
import { normalizePlan } from '@repo/types';
import type { Plan } from '@repo/types';

export const dynamic = 'force-dynamic';

/** Response shape when there is no subscription row to return. */
function syntheticSubscription(userId: string, plan: Plan) {
  return {
    id: null,
    user_id: userId,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    plan,
    status: plan === 'unpaid' ? 'canceled' : 'active',
    current_period_start: null,
    current_period_end: null,
    seats: null,
    billing_interval: null,
    created_at: null,
    updated_at: null,
  };
}

// GET /api/billing/subscription — the current user's subscription (plan 'unpaid' if none)
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Service client: reads subscription + platform owner check for billing display. Accesses: subscriptions, user_roles.
    const service = createServiceClient();

    // Check if platform owner (app creator — unlimited, no subscription needed)
    // MUST use app_metadata only — user_roles.role='owner' is every org owner
    const { data: ownerCheck } = await service.auth.admin.getUserById(user.id);
    if (ownerCheck?.user?.app_metadata?.is_platform_owner === true) {
      return NextResponse.json(syntheticSubscription(user.id, 'platform_owner'));
    }

    const { data: sub } = await service
      .from('subscriptions')
      .select(
        'id, user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_start, current_period_end, seats, billing_interval, created_at, updated_at',
      )
      .eq('user_id', user.id)
      .maybeSingle();

    // Enterprise set by hand ranks above any access code, as in decidePlan.
    const enterpriseRow =
      sub && normalizePlan(sub.plan) === 'enterprise' && sub.status !== 'canceled';

    // An active access code (comp or Enterprise) this user redeemed covers the orgs they own.
    const { data: activeCode } = enterpriseRow
      ? { data: null }
      : await service
          .from('access_codes')
          .select('id, plan')
          .eq('redeemed_by', user.id)
          .is('revoked_at', null)
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
          .limit(1)
          .maybeSingle();

    if (activeCode) {
      const plan = normalizePlan(activeCode.plan) === 'enterprise' ? 'enterprise' : 'cloud';
      return NextResponse.json(syntheticSubscription(user.id, plan));
    }

    if (!sub) return NextResponse.json(syntheticSubscription(user.id, 'unpaid'));

    const plan = normalizePlan(sub.plan);
    // Enterprise is set by hand; a Cloud row only counts with a live Stripe subscription.
    const paying = hasAccess(sub.status);
    const enterprise = plan === 'enterprise' && sub.status !== 'canceled';
    const effective: Plan = enterprise || (paying && sub.stripe_subscription_id) ? plan : 'unpaid';
    return NextResponse.json({ ...sub, plan: effective });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
