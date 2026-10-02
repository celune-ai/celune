'use client';

import { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { Tabs, TabsList, TabsTrigger } from '@repo/ui/components/tabs';
import { apiUrl } from '@repo/db/api';
import { CLOUD_SEAT_PRICE_USD } from '@repo/types';
import type { BillingInterval } from '@repo/types';
import { fetchJson } from '@/lib/fetch-json';
import { SALES_EMAIL } from '@/lib/branding';

interface CloudCheckoutProps {
  /** App path Stripe returns to after a completed checkout. Defaults to the billing tab. */
  successPath?: string;
  /** App path Stripe returns to when the user backs out. Defaults to the billing tab. */
  cancelPath?: string;
  disabled?: boolean;
}

/**
 * Celune Cloud checkout: a monthly or annual choice and a Subscribe button that
 * opens Stripe Checkout. The seat count comes from the server (active org members).
 */
export function CloudCheckout({ successPath, cancelPath, disabled }: CloudCheckoutProps) {
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('month');
  const [loading, setLoading] = useState(false);
  const stripeConfigured = !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  async function handleCheckout() {
    setLoading(true);
    const origin = window.location.origin;
    try {
      const { url } = await fetchJson<{ url: string }>(apiUrl('/api/billing/checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interval: billingInterval,
          ...(successPath && { success_url: `${origin}${successPath}` }),
          ...(cancelPath && { cancel_url: `${origin}${cancelPath}` }),
        }),
      });
      if (url) window.location.href = url;
      else setLoading(false);
    } catch {
      toast.error('Failed to start checkout');
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-foreground text-3xl font-bold">
            ${CLOUD_SEAT_PRICE_USD[billingInterval]}
          </span>
          <span className="text-muted-foreground text-sm"> per seat per month</span>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {billingInterval === 'year'
              ? `Billed annually ($${CLOUD_SEAT_PRICE_USD.year * 12} per seat per year)`
              : 'Billed monthly'}
          </p>
        </div>
        <Tabs
          value={billingInterval}
          onValueChange={(v) => setBillingInterval(v as BillingInterval)}
        >
          <TabsList aria-label="Billing interval">
            <TabsTrigger value="month">Monthly</TabsTrigger>
            <TabsTrigger value="year">Annual</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <ul className="text-muted-foreground space-y-1 text-sm">
        <li>One seat per active member of your organization. Agents are free.</li>
        <li>Unlimited agents, workspaces, and memories.</li>
        <li>Bring your own model keys; Celune never bills model usage.</li>
      </ul>

      <Button
        className="w-full"
        disabled={disabled || loading || !stripeConfigured}
        title={!stripeConfigured ? 'Billing is not configured on this host' : undefined}
        onClick={handleCheckout}
      >
        {loading ? <Loader2 className="animate-spin" /> : null}
        {loading ? 'Redirecting...' : 'Subscribe to Celune Cloud'}
        {!loading && <ArrowRight />}
      </Button>

      <p className="text-muted-foreground text-center text-xs">
        Need custom terms or a dedicated contract?{' '}
        <a href={`mailto:${SALES_EMAIL}`} className="text-brand-link underline underline-offset-2">
          Contact sales about Enterprise
        </a>
      </p>
    </div>
  );
}
