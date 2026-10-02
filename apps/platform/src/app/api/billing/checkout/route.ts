import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { createServiceClient } from '@repo/db/service';
import { validateOrigin } from '@/lib/csrf';
import { safeErrorResponse } from '@/lib/api-error';
import { cloudPriceId, getStripe } from '@/lib/stripe';
import { countSeats } from '@/lib/billing-seats';
import { SALES_EMAIL } from '@/lib/branding';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { z } from 'zod';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

const checkoutSchema = z.object({
  plan: z.enum(['cloud', 'enterprise']).default('cloud'),
  interval: z.enum(['month', 'year']).default('month'),
  success_url: z.string().url().optional(),
  cancel_url: z.string().url().optional(),
});

export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'billing.checkout.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: 'Billing not yet configured', code: 'stripe_not_configured' },
      { status: 503 },
    );
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const parsed = await parseBody(request, checkoutSchema);
    if (isErrorResponse(parsed)) return parsed;

    if (parsed.plan === 'enterprise') {
      return NextResponse.json(
        {
          error: `Enterprise has no self-serve checkout. Contact sales at ${SALES_EMAIL}.`,
          code: 'contact_sales',
        },
        { status: 400 },
      );
    }

    // Service client: the payer must own an org; its members are the seats. Accesses: organizations.
    const service = createServiceClient();
    const { data: ownedOrg } = await service
      .from('organizations')
      .select('id')
      .eq('owner_id', user.id)
      .limit(1)
      .maybeSingle();
    if (!ownedOrg) {
      return NextResponse.json(
        { error: 'Only an organization owner can subscribe.', code: 'not_org_owner' },
        { status: 403 },
      );
    }

    const priceId = cloudPriceId(parsed.interval);
    if (!priceId) {
      return NextResponse.json({ error: 'Plan price not configured' }, { status: 503 });
    }

    // Service client: looks up existing Stripe customer ID for checkout. Accesses: subscriptions.
    const { data: sub } = await service
      .from('subscriptions')
      .select('stripe_customer_id, stripe_subscription_id, status')
      .eq('user_id', user.id)
      .maybeSingle();

    if (sub?.stripe_subscription_id && sub.status !== 'canceled') {
      return NextResponse.json(
        { error: 'You already have a subscription. Use Manage billing to change it.' },
        { status: 409 },
      );
    }

    let customerId = sub?.stripe_customer_id;

    // Create customer if needed
    if (!customerId) {
      // Same key for 24 hours, so repeated or abandoned checkouts reuse one customer.
      const emailKey = createHash('sha256')
        .update(user.email ?? '')
        .digest('hex')
        .slice(0, 16);
      const customer = await stripe.customers.create(
        { email: user.email, metadata: { user_id: user.id } },
        { idempotencyKey: `cloud-customer:${user.id}:${emailKey}` },
      );
      customerId = customer.id;
    }

    const origin = request.nextUrl.origin;
    // One seat per active human org member across the orgs this user owns, minimum 1.
    const quantity = await countSeats(user.id);
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity }],
      success_url: parsed.success_url ?? `${origin}/settings?tab=billing&success=1`,
      cancel_url: parsed.cancel_url ?? `${origin}/settings?tab=billing&canceled=1`,
      metadata: { user_id: user.id, plan: 'cloud' },
      subscription_data: {
        metadata: { user_id: user.id, plan: 'cloud' },
      },
    };
    // A double click or retry within the same minute returns the same session instead of a
    // second one that could become a second subscription.
    const minute = Math.floor(Date.now() / 60_000);
    const idempotencyKey = `cloud-checkout:${user.id}:${minute}:${createHash('sha256')
      .update(JSON.stringify(sessionParams))
      .digest('hex')
      .slice(0, 32)}`;
    const session = await stripe.checkout.sessions.create(sessionParams, { idempotencyKey });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
