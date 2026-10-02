/**
 * @vitest-environment jsdom
 *
 * AdminLayout orders the paywall before onboarding: an unpaid owner never sees the
 * onboarding wizard, and /subscribe renders bare with no overlay.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

let plan = { isLoading: false, isUnpaid: true, isPlatformOwner: false };
vi.mock('@/hooks/use-plan', () => ({ usePlan: () => plan }));

let onboarding = { shouldShow: true, isBlocked: true, loading: false };
vi.mock('../onboarding/use-onboarding', () => ({ useOnboarding: () => onboarding }));

const { pass, none } = vi.hoisted(() => ({
  pass: ({ children }: { children?: ReactNode }) => children ?? null,
  none: () => null,
}));
vi.mock('@/providers/query-provider', () => ({ QueryProvider: pass }));
vi.mock('@/providers/workspace-provider', () => ({ WorkspaceProvider: pass }));
vi.mock('@/providers/plan-provider', () => ({ PlanProvider: pass }));
vi.mock('@/providers/celune-react-provider', () => ({ PlatformCeluneProvider: pass }));
vi.mock('@/providers/support-chat-provider', () => ({ SupportChatProvider: pass }));
vi.mock('../support-widget', () => ({ SupportWidget: pass }));
vi.mock('../migration-banner', () => ({ MigrationStatusProvider: pass, MigrationBanner: none }));
vi.mock('../admin-nav', () => ({ AdminNav: none }));
vi.mock('../billing-banner', () => ({ BillingBanner: none }));
vi.mock('../downgrade-banner', () => ({ DowngradeBanner: none }));
vi.mock('../suspension-banner', () => ({ SuspensionBanner: none }));
vi.mock('../brain-update-banner', () => ({ BrainUpdateBanner: none }));
vi.mock('../provider-key-banner', () => ({ ProviderKeyBanner: none }));
vi.mock('../github-disconnect-banner', () => ({ GitHubDisconnectBanner: none }));
vi.mock('../paywall-gate', () => ({
  PaywallGate: ({ children }: { children: ReactNode }) => (
    <div data-testid="paywall-gate">{children}</div>
  ),
}));
vi.mock('../onboarding/onboarding-fullscreen', () => ({
  OnboardingFullScreen: () => <div data-testid="wizard" />,
}));
vi.mock('../onboarding/setup-blocker', () => ({
  SetupBlocker: () => <div data-testid="setup-blocker" />,
}));

import { AdminLayout } from '../admin-layout';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  pathname = '/';
  plan = { isLoading: false, isUnpaid: true, isPlatformOwner: false };
  onboarding = { shouldShow: true, isBlocked: true, loading: false };
});

describe('AdminLayout paywall ordering', () => {
  it('renders /subscribe bare for an unpaid owner, with no onboarding overlay', () => {
    pathname = '/subscribe';
    render(<AdminLayout>subscribe page</AdminLayout>);

    expect(screen.getByText('subscribe page')).toBeTruthy();
    expect(screen.queryByTestId('wizard')).toBeNull();
    expect(screen.queryByTestId('setup-blocker')).toBeNull();
    expect(screen.queryByTestId('paywall-gate')).toBeNull();
  });

  it('routes an unpaid owner through the paywall instead of onboarding elsewhere', () => {
    render(<AdminLayout>dashboard</AdminLayout>);

    expect(screen.getByTestId('paywall-gate').textContent).toBe('dashboard');
    expect(screen.queryByTestId('wizard')).toBeNull();
    expect(screen.queryByTestId('setup-blocker')).toBeNull();
  });

  it('opens onboarding once the plan is active', () => {
    plan = { isLoading: false, isUnpaid: false, isPlatformOwner: false };
    render(<AdminLayout>dashboard</AdminLayout>);

    expect(screen.getByTestId('wizard')).toBeTruthy();
  });
});
