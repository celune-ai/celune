'use client';

import { Suspense, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@repo/ui/components/button';
import { CreditCard, Users } from 'lucide-react';
import { toast } from 'sonner';
import { usePlan } from '@/hooks/use-plan';
import { SUPPORT_EMAIL } from '@/lib/branding';
import { CloudCheckout } from '@/components/settings/cloud-checkout';
import { CheckoutReturnNotice } from '@/components/settings/checkout-return-notice';

/**
 * Paywall page for an org without an active plan. Celune Cloud has no trial,
 * so a new org lands here after sign-up.
 *
 * - Org owner: Cloud checkout with a monthly or annual choice
 * - Other members: told the owner needs to subscribe
 *
 * This page is outside the [workspace] layout so it renders without the
 * admin nav.
 */
function SubscribeContent() {
  const { isUnpaid, isWorkspaceOwner, isPlatformOwner, isLoading, hasNoWorkspace } = usePlan();
  const router = useRouter();
  const returnedFromCheckout = useSearchParams().get('success') === '1';
  // Orgs with a plan (and the platform owner) have nothing to do here
  const hasAccess = !isLoading && !hasNoWorkspace && (!isUnpaid || isPlatformOwner);
  useEffect(() => {
    if (!hasAccess) return;
    if (returnedFromCheckout) toast.success('Your Celune Cloud subscription is active.');
    router.replace('/');
  }, [hasAccess, returnedFromCheckout, router]);

  // The paywall redirects here from another page; move focus to the heading so screen
  // readers announce where the user landed.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const showsHeading = hasNoWorkspace || (!isLoading && !hasAccess);
  useEffect(() => {
    if (showsHeading) headingRef.current?.focus();
  }, [showsHeading]);

  if (hasNoWorkspace) {
    return (
      <div className="bg-background flex min-h-dvh flex-col items-center justify-center px-4">
        <div className="w-full max-w-lg text-center">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-foreground mb-2 text-2xl font-bold outline-none"
          >
            No workspace yet
          </h1>
          <p className="text-muted-foreground mb-6 text-base">
            You are not a member of any workspace, so there is nothing to subscribe to. Create a
            workspace, or ask an organization owner to invite you.
          </p>
          <Button asChild>
            <Link href="/">Go to Celune</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading || hasAccess) {
    // On a return from checkout the notice says the payment is activating.
    return (
      <div className="bg-background flex min-h-dvh items-center justify-center px-4">
        <div className="w-full max-w-lg">
          {returnedFromCheckout ? (
            <CheckoutReturnNotice />
          ) : (
            <div className="text-muted-foreground text-center text-sm">Loading...</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background flex min-h-dvh flex-col items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <div className="bg-brand/10 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
            {isWorkspaceOwner ? (
              <CreditCard className="text-brand h-8 w-8" />
            ) : (
              <Users className="text-brand h-8 w-8" />
            )}
          </div>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-foreground mb-2 text-2xl font-bold outline-none"
          >
            {isWorkspaceOwner ? 'Subscribe to Celune Cloud' : 'Waiting for the organization owner'}
          </h1>
          <p className="text-muted-foreground text-base">
            {isWorkspaceOwner
              ? 'Choose monthly or annual billing to start using Celune. Your data is kept while you decide.'
              : 'This organization does not have a Celune Cloud subscription yet. Ask the organization owner to subscribe to restore your access.'}
          </p>
        </div>

        <div className="mb-4">
          <CheckoutReturnNotice />
        </div>

        {isWorkspaceOwner && (
          <div className="border-border bg-card rounded-lg border p-6">
            <CloudCheckout successPath="/subscribe?success=1" cancelPath="/subscribe?canceled=1" />
          </div>
        )}

        <div className="text-muted-foreground mt-6 text-center text-xs">
          Need help?{' '}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-brand-link underline underline-offset-2"
          >
            Contact support
          </a>
        </div>
      </div>
    </div>
  );
}

export default function SubscribePage() {
  // useSearchParams needs a Suspense boundary for the static prerender.
  return (
    <Suspense>
      <SubscribeContent />
    </Suspense>
  );
}
