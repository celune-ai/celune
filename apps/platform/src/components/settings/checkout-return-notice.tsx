'use client';

import { useSearchParams } from 'next/navigation';
import { Alert, AlertDescription } from '@repo/ui/components/alert';
import { usePlan } from '@/hooks/use-plan';
import { SUPPORT_EMAIL } from '@/lib/branding';

/**
 * Message for a return from Stripe Checkout: success=1 (paid) or canceled=1 (backed
 * out). After a payment the plan provider polls until the webhook activates the plan,
 * so success shows "activating" while it loads and a delay notice if it never does.
 */
export function CheckoutReturnNotice() {
  const params = useSearchParams();
  const { isLoading, isUnpaid } = usePlan();

  if (params.get('success') === '1') {
    if (isLoading) {
      return (
        <Alert variant="info" role="status">
          <AlertDescription>Payment received. Activating your subscription…</AlertDescription>
        </Alert>
      );
    }
    if (isUnpaid) {
      return (
        <Alert variant="warning">
          <AlertDescription>
            Stripe has not confirmed the payment yet. It can take a minute; refresh this page. If
            this message stays, contact {SUPPORT_EMAIL}.
          </AlertDescription>
        </Alert>
      );
    }
    return (
      <Alert variant="success" role="status">
        <AlertDescription>Your Celune Cloud subscription is active.</AlertDescription>
      </Alert>
    );
  }

  if (params.get('canceled') === '1') {
    return (
      <Alert role="status">
        <AlertDescription>Checkout canceled. You have not been charged.</AlertDescription>
      </Alert>
    );
  }

  return null;
}
