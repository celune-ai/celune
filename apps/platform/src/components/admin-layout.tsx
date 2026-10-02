'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AdminNav } from './admin-nav';
import { SupportWidget } from './support-widget';
import { MigrationStatusProvider, MigrationBanner } from './migration-banner';
import { BillingBanner } from './billing-banner';
import { DowngradeBanner } from './downgrade-banner';
import { SuspensionBanner } from './suspension-banner';
import { QueryProvider } from '@/providers/query-provider';
import { WorkspaceProvider } from '@/providers/workspace-provider';
import { PlatformCeluneProvider } from '@/providers/celune-react-provider';
import { PlanProvider } from '@/providers/plan-provider';
import { SupportChatProvider } from '@/providers/support-chat-provider';
import { OnboardingFullScreen } from './onboarding/onboarding-fullscreen';
import { useOnboarding } from './onboarding/use-onboarding';
import { SetupBlocker } from './onboarding/setup-blocker';
import { BrainUpdateBanner } from './brain-update-banner';
import { ProviderKeyBanner } from './provider-key-banner';
import { PaywallGate } from './paywall-gate';
import { usePlan } from '@/hooks/use-plan';
import { shellPhase } from '@/lib/shell-phase';
import { GitHubDisconnectBanner } from './github-disconnect-banner';

const AUTH_PATHS = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/check-email',
  '/welcome',
  '/chat/embed',
  '/device/verify',
];

/** Pages that render bare inside the providers: no nav, banners, or onboarding overlay. */
const BARE_PATHS = ['/subscribe'];

function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { shouldShow, isBlocked, loading } = useOnboarding();
  const { isLoading: planLoading, isUnpaid, isPlatformOwner } = usePlan();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);
  const bare = BARE_PATHS.includes(pathname);

  // Paid from day one: an unpaid org owner subscribes before onboarding starts.
  const phase = shellPhase({
    planLoading,
    onboardingLoading: loading,
    isUnpaid,
    isPlatformOwner,
    onboardingPending: shouldShow,
    onboardingDismissed,
  });

  useEffect(() => {
    if (phase === 'onboarding' && !bare) setWizardOpen(true);
  }, [phase, bare]);

  /** Keep --banner-height CSS variable in sync with the banner container height */
  const syncBannerHeight = useCallback(() => {
    const h = bannerRef.current?.offsetHeight ?? 0;
    document.documentElement.style.setProperty('--banner-height', `${h}px`);
  }, []);

  useEffect(() => {
    syncBannerHeight();
    const observer = new ResizeObserver(syncBannerHeight);
    if (bannerRef.current) observer.observe(bannerRef.current);
    return () => observer.disconnect();
  }, [syncBannerHeight]);

  if (bare) return <>{children}</>;

  // Hide dashboard while onboarding is loading or active to prevent flash. While unpaid the
  // shell renders so PaywallGate can send the user to /subscribe (settings stays reachable).
  const showDashboard = phase === 'paywall' || (phase === 'app' && !wizardOpen);

  return (
    <SupportWidget>
      {showDashboard ? (
        <div className="flex h-dvh flex-col">
          {/* Banners — stacked above everything, set --banner-height */}
          <div ref={bannerRef} className="shrink-0">
            <SuspensionBanner />
            <BillingBanner />
            <ProviderKeyBanner />
            <DowngradeBanner />
            <MigrationBanner />
            <GitHubDisconnectBanner />
            <BrainUpdateBanner />
          </div>

          {/* Nav + main content area fills remaining height */}
          <div className="relative flex min-h-0 flex-1">
            <AdminNav />
            <main className="flex-1 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
              <PlatformCeluneProvider>
                <PaywallGate>{children}</PaywallGate>
              </PlatformCeluneProvider>
            </main>
          </div>
        </div>
      ) : (
        /* Black screen while checking onboarding state or waiting for wizard to mount */
        <div className="h-dvh bg-[#0a0a0a]" />
      )}
      {phase !== 'paywall' && !loading && isBlocked && !wizardOpen && !onboardingDismissed && (
        <SetupBlocker onResume={() => setWizardOpen(true)} />
      )}
      {wizardOpen && (
        <OnboardingFullScreen
          onClose={() => {
            setWizardOpen(false);
            setOnboardingDismissed(true);
          }}
        />
      )}
    </SupportWidget>
  );
}

function AdminLayoutInner({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <WorkspaceProvider>
        <PlanProvider>
          <MigrationStatusProvider>
            <SupportChatProvider>
              <AdminShell>{children}</AdminShell>
            </SupportChatProvider>
          </MigrationStatusProvider>
        </PlanProvider>
      </WorkspaceProvider>
    </QueryProvider>
  );
}

export function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return <>{children}</>;
  }

  return <AdminLayoutInner>{children}</AdminLayoutInner>;
}
