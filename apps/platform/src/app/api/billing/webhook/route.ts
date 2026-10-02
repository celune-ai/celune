import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { createServiceClient } from '@repo/db/service';
import { getStripe, priceIdToPlan } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Testing: Use Stripe CLI to forward webhooks locally:
//   stripe listen --forward-to localhost:3002/api/billing/webhook
//   stripe trigger checkout.session.completed
//   stripe trigger customer.subscription.updated
//   stripe trigger customer.subscription.deleted
//   stripe trigger invoice.payment_failed

async function handleSubscriptionUpsert(subscription: Stripe.Subscription) {
  // Service client: upserts subscription records from Stripe webhooks. Accesses: subscriptions.
  const supabase = createServiceClient();
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

  // Look up user by stripe_customer_id or metadata
  const userId = subscription.metadata?.user_id;
  if (!userId) {
    console.warn('[Stripe Webhook] No user_id in subscription metadata', subscription.id);
    return;
  }

  const item = subscription.items.data[0];
  const plan = priceIdToPlan(item?.price.id ?? '');
  // A price this host does not sell grants nothing; the event is acked so Stripe stops retrying.
  if (!plan) {
    console.error('[Stripe Webhook] Subscription on an unknown price; not stored', subscription.id);
    return;
  }
  const interval = item?.price.recurring?.interval;

  const { error } = await supabase.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      plan,
      seats: item?.quantity ?? null,
      billing_interval: interval === 'month' || interval === 'year' ? interval : null,
      // past_due (and incomplete, while Stripe retries) keeps access with a warning; unpaid,
      // incomplete_expired, paused, and canceled become canceled, which the paywall blocks.
      status:
        subscription.status === 'active' || subscription.status === 'trialing'
          ? 'active'
          : subscription.status === 'past_due' || subscription.status === 'incomplete'
            ? 'past_due'
            : 'canceled',
      current_period_start: item?.current_period_start
        ? new Date(item.current_period_start * 1000).toISOString()
        : null,
      current_period_end: item?.current_period_end
        ? new Date(item.current_period_end * 1000).toISOString()
        : null,
    },
    { onConflict: 'user_id' },
  );
  if (error) throw new Error(`[Stripe Webhook] subscriptions write failed: ${error.message}`);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  // Service client: downgrades subscription on cancellation. Accesses: subscriptions.
  const supabase = createServiceClient();
  const userId = subscription.metadata?.user_id;
  if (!userId) return;

  // Canceled: the org falls back to the paywall until it subscribes again.
  const { error } = await supabase
    .from('subscriptions')
    .update({
      plan: 'cloud',
      status: 'canceled',
      stripe_subscription_id: null,
    })
    .eq('user_id', userId)
    // Only the subscription that ended: a late delete for an old one must not cancel a newer one.
    .eq('stripe_subscription_id', subscription.id);
  if (error) throw new Error(`[Stripe Webhook] subscriptions write failed: ${error.message}`);
}

/** Since 2025-03-31.basil the subscription lives under parent.subscription_details; older payloads kept it on the invoice. */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | undefined {
  const current = invoice.parent?.subscription_details?.subscription;
  const legacy = (invoice as unknown as { subscription?: string | { id?: string } | null })
    .subscription;
  const ref = current ?? legacy;
  return typeof ref === 'string' ? ref : (ref?.id ?? undefined);
}

/**
 * Database failures throw, so the route answers 500 and Stripe retries the event.
 * A 2xx tells Stripe the state was stored.
 */
export async function POST(request: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
  }

  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Missing webhook signature' }, { status: 400 });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('[Stripe Webhook] Signature verification failed:', err);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpsert(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.user_id;
        if (userId && session.subscription) {
          const subId =
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          await handleSubscriptionUpsert(sub);
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoiceSubscriptionId(invoice);
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          const userId = sub.metadata?.user_id;
          if (userId) {
            // Service client: marks subscription as past_due on payment failure. Accesses: subscriptions.
            const supabase = createServiceClient();
            const { error } = await supabase
              .from('subscriptions')
              .update({ status: 'past_due' })
              .eq('user_id', userId);
            if (error)
              throw new Error(`[Stripe Webhook] subscriptions write failed: ${error.message}`);
          }
        }
        console.warn('[Stripe Webhook] Payment failed:', invoice.id);
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    // Always 500, never a mapped 4xx, so Stripe retries the event with its backoff.
    console.error('[Stripe Webhook] Handling failed; Stripe will retry:', error);
    return NextResponse.json({ error: 'Webhook handling failed' }, { status: 500 });
  }
}
