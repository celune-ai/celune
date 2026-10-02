'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, X, CreditCard } from 'lucide-react';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';
import { usePlan } from '@/hooks/use-plan';

const SESSION_KEY = 'billing_banner_dismissed';

/**
 * Warning banner shown to every member while the org's Cloud payment is past due.
 * Access continues while Stripe retries; the org owner can update the payment method.
 * Dismissible per session; reappears on the next visit.
 * Shown on all authenticated pages via AdminLayout.
 */
export function BillingBanner() {
  const { past_due: pastDue, isWorkspaceOwner: isOrgOwner, isLoading } = usePlan();
  const [dismissed, setDismissed] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem(SESSION_KEY)) {
      setDismissed(true);
    }
  }, []);

  function handleDismiss() {
    sessionStorage.setItem(SESSION_KEY, '1');
    setDismissed(true);
  }

  async function handleUpdatePayment() {
    setPortalLoading(true);
    try {
      const { url } = await fetchJson<{ url: string }>(apiUrl('/api/billing/portal'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (url) window.location.href = url;
    } catch {
      // Portal request failed — silently ignore; user can navigate to settings manually
    } finally {
      setPortalLoading(false);
    }
  }

  if (dismissed || isLoading || !pastDue) return null;

  return (
    <div
      role="alert"
      className="border-warning/20 bg-warning/10 text-warning flex items-center gap-3 border-b px-4 py-2 text-sm"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">
        {isOrgOwner
          ? 'Your payment failed. Update your payment method to keep access to Celune Cloud.'
          : 'This organization’s payment failed. Ask the organization owner to update the payment method.'}
      </span>
      {isOrgOwner && (
        <button
          type="button"
          onClick={handleUpdatePayment}
          disabled={portalLoading}
          className="border-warning/30 bg-warning/10 text-warning hover:bg-warning/20 flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50"
        >
          <CreditCard className="h-3.5 w-3.5" />
          {portalLoading ? 'Loading…' : 'Update payment method'}
        </button>
      )}
      <button
        type="button"
        onClick={handleDismiss}
        className="text-warning hover:bg-warning/10 hover:text-warning-400 shrink-0 rounded-md p-2 transition-colors"
        aria-label="Dismiss billing warning"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
