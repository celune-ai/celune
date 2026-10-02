'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { usePlan } from '@/hooks/use-plan';
import type { ReactNode } from 'react';

/**
 * Paths that stay reachable while the org has no plan.
 * - /subscribe: the checkout page itself
 * - /settings: the billing tab, where an owner can also subscribe
 */
const PAYWALL_WHITELIST = ['/subscribe', '/settings'];

function isWhitelisted(pathname: string): boolean {
  // Check workspace-scoped paths: /[slug]/settings
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length >= 2 && segments[1] === 'settings') return true;

  return PAYWALL_WHITELIST.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/**
 * Client-side paywall: sends every member of an org without an active plan to
 * /subscribe, where the owner checks out and other members are told to ask the
 * owner. The community edition and the platform owner never resolve to `unpaid`.
 * Placed in AdminLayoutInner to catch all authenticated page navigation.
 */
export function PaywallGate({ children }: { children: ReactNode }) {
  const { isUnpaid, isPlatformOwner, isLoading } = usePlan();
  const pathname = usePathname();
  const router = useRouter();
  const blocked = !isLoading && isUnpaid && !isPlatformOwner && !isWhitelisted(pathname);

  useEffect(() => {
    if (blocked) router.replace('/subscribe');
  }, [blocked, router]);

  // Don't render protected content while redirecting to avoid flash
  if (blocked) return null;

  return <>{children}</>;
}
