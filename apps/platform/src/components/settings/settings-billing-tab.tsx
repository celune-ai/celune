'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CreditCard, Loader2, Ticket, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { Badge } from '@repo/ui/components/badge';
import { Input } from '@repo/ui/components/input';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';
import type { Subscription } from '@repo/types';
import { PLAN_LABELS } from '@repo/types';
import { SALES_EMAIL } from '@/lib/branding';
import { usePlan } from '@/hooks/use-plan';
import { UsageMeters } from './usage-meters';
import { CloudCheckout } from './cloud-checkout';
import { CheckoutReturnNotice } from './checkout-return-notice';

/* ────────────────────────────────────────────────────────────────────────── */

interface SettingsBillingTabProps {
  workspaceId: string;
}

function formatDate(iso: string | null): string | null {
  return iso ? new Date(iso).toLocaleDateString() : null;
}

function PlanFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-foreground mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}

export function SettingsBillingTab({ workspaceId }: SettingsBillingTabProps) {
  // Only the org owner pays for the org; everyone else is told to ask them.
  const { isWorkspaceOwner: isOrgOwner } = usePlan();
  // ── Billing state ──────────────────────────────────────────────────────
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);

  // ── Access code state ──────────────────────────────────────────────────
  const [accessCode, setAccessCode] = useState('');
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [revokeLoading, setRevokeLoading] = useState(false);

  const plan = subscription?.plan ?? 'unpaid';
  const hasStripeSubscription =
    !!subscription?.stripe_subscription_id && subscription.status !== 'canceled';
  const isAccessCode = plan === 'cloud' && !subscription?.stripe_subscription_id;

  // ── Data fetching ──────────────────────────────────────────────────────
  const fetchBilling = useCallback(async () => {
    setBillingLoading(true);
    try {
      const sub = await fetchJson<Subscription>(apiUrl('/api/billing/subscription'));
      setSubscription(sub);
    } catch {
      toast.error('Failed to load billing info');
    } finally {
      setBillingLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBilling();
  }, [fetchBilling]);

  // ── Actions ────────────────────────────────────────────────────────────
  const handleManageBilling = useCallback(async () => {
    setPortalLoading(true);
    try {
      const { url } = await fetchJson<{ url: string }>(apiUrl('/api/billing/portal'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (url) window.location.href = url;
    } catch {
      toast.error('Failed to open billing portal');
    } finally {
      setPortalLoading(false);
    }
  }, []);

  const handleRedeemCode = useCallback(async () => {
    const code = accessCode.trim();
    if (!code) return;
    setRedeemLoading(true);
    try {
      await fetchJson(apiUrl('/api/access-codes/redeem'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      setAccessCode('');
      toast.success('Access code redeemed');
      await fetchBilling();
      // Notify all plan hooks app-wide to refresh permissions
      window.dispatchEvent(new Event('celune:plan-changed'));
    } catch {
      toast.error('Invalid or expired access code');
    } finally {
      setRedeemLoading(false);
    }
  }, [accessCode, fetchBilling]);

  const handleRevokeCode = useCallback(async () => {
    if (!confirm('Remove your access code? You will need a Celune Cloud subscription to continue.'))
      return;
    setRevokeLoading(true);
    try {
      await fetchJson(apiUrl('/api/access-codes/redeem'), { method: 'DELETE' });
      toast.success('Access code removed');
      await fetchBilling();
      window.dispatchEvent(new Event('celune:plan-changed'));
    } catch {
      toast.error('Failed to remove access code');
    } finally {
      setRevokeLoading(false);
    }
  }, [fetchBilling]);

  const header = (
    <div>
      <h2 className="text-foreground mb-1 flex items-center gap-2 text-lg font-medium">
        <CreditCard className="h-5 w-5" />
        Billing
      </h2>
      <p className="text-muted-foreground text-sm">Manage your subscription and seats.</p>
    </div>
  );

  // ── Loading state ──────────────────────────────────────────────────────
  if (billingLoading) {
    return (
      <div className="space-y-8">
        {header}
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      </div>
    );
  }

  // ── Plan card body ─────────────────────────────────────────────────────
  let planBody: ReactNode;
  if (plan === 'enterprise') {
    planBody = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          Your Enterprise plan is billed by contract. Contact sales to change seats or terms.
        </p>
        <Button variant="outline" asChild>
          <a href={`mailto:${SALES_EMAIL}`}>Contact sales</a>
        </Button>
      </div>
    );
  } else if (plan === 'platform_owner') {
    planBody = (
      <p className="text-muted-foreground text-sm">
        Full access as the platform owner. No subscription is needed.
      </p>
    );
  } else if (hasStripeSubscription) {
    planBody = (
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <PlanFact label="Seats" value={String(subscription?.seats ?? 1)} />
          <PlanFact
            label="Billing"
            value={subscription?.billing_interval === 'year' ? 'Annual' : 'Monthly'}
          />
          <PlanFact
            label="Next invoice"
            value={formatDate(subscription?.current_period_end ?? null) ?? 'Not scheduled'}
          />
        </dl>
        <p className="text-muted-foreground text-xs">
          Seats follow your active organization members and update automatically, prorated.
        </p>
        <Button variant="outline" disabled={portalLoading} onClick={handleManageBilling}>
          {portalLoading ? <Loader2 className="animate-spin" /> : null}
          Manage billing
        </Button>
      </div>
    );
  } else if (isAccessCode) {
    planBody = (
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Ticket className="text-muted-foreground h-4 w-4" />
          <p className="text-muted-foreground text-sm">Granted by an access code.</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Remove access code"
          onClick={handleRevokeCode}
          disabled={revokeLoading}
        >
          {revokeLoading ? <Loader2 className="animate-spin" /> : <Trash2 />}
        </Button>
      </div>
    );
  } else if (isOrgOwner) {
    planBody = <CloudCheckout />;
  } else {
    planBody = (
      <p className="text-muted-foreground text-sm">
        The organization owner manages billing. Ask them to subscribe to Celune Cloud.
      </p>
    );
  }

  const planTitle = plan === 'unpaid' ? PLAN_LABELS.cloud : PLAN_LABELS[plan];
  const status = hasStripeSubscription ? subscription?.status : null;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      {header}

      <CheckoutReturnNotice />

      {/* ─── 1. Plan card ─────────────────────────────────────────────── */}
      <div className="bg-surface-75 border-border space-y-4 rounded-lg border p-6">
        <div className="flex items-center gap-2">
          <span className="text-foreground text-lg font-semibold">{planTitle}</span>
          {status && (
            <Badge variant={status === 'active' ? 'default' : 'destructive'} size="sm">
              {status.replace('_', ' ')}
            </Badge>
          )}
          {plan === 'unpaid' && !hasStripeSubscription && (
            <Badge variant="destructive" size="sm">
              Not subscribed
            </Badge>
          )}
        </div>
        {planBody}
      </div>

      {/* ─── 2. Access Code ──────────────────────────────────────────── */}
      {plan === 'unpaid' && !hasStripeSubscription && (
        <div className="bg-surface-75 border-border rounded-lg border p-5">
          <div className="mb-3 flex items-center gap-2">
            <Ticket className="text-muted-foreground h-4 w-4" />
            <h3 className="text-foreground text-sm font-medium">Have an access code?</h3>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              placeholder="Enter access code"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRedeemCode();
              }}
              className="max-w-xs"
              disabled={redeemLoading}
            />
            <Button
              variant="outline"
              onClick={handleRedeemCode}
              disabled={redeemLoading || !accessCode.trim()}
            >
              {redeemLoading ? <Loader2 className="animate-spin" /> : null}
              Redeem
            </Button>
          </div>
        </div>
      )}

      {/* ─── 3. Usage Meters ──────────────────────────────────────────── */}
      <UsageMeters workspaceId={workspaceId} />
    </div>
  );
}
