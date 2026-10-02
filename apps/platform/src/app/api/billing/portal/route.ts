import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { createServiceClient } from '@repo/db/service';
import { validateOrigin } from '@/lib/csrf';
import { safeErrorResponse } from '@/lib/api-error';
import { getStripe } from '@/lib/stripe';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'billing.portal.post', RATE_WRITE);
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

    // Service client: reads Stripe customer ID for portal session. Accesses: subscriptions.
    const service = createServiceClient();
    const { data: sub } = await service
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single();

    if (!sub?.stripe_customer_id) {
      return NextResponse.json({ error: 'No billing account found' }, { status: 404 });
    }

    const origin = request.nextUrl.origin;
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${origin}/settings?tab=billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
