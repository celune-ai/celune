/**
 * @vitest-environment jsdom
 *
 * Tests for FeatureGate, UpgradePrompt, and useFeatureGate.
 *
 * Covers:
 * - FeatureGate hides content when feature unavailable (hide mode)
 * - FeatureGate shows lock overlay when feature unavailable (disable mode)
 * - FeatureGate renders children when feature available
 * - UpgradePrompt shows badge when feature unavailable
 * - UpgradePrompt renders nothing when feature available
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

let mockHasFeature = vi.fn().mockReturnValue(true);
let mockIsLoading = false;

vi.mock('@/hooks/use-plan', () => ({
  usePlan: () => ({
    hasFeature: mockHasFeature,
    isLoading: mockIsLoading,
  }),
}));

vi.mock('@/hooks/use-workspace-href', () => ({
  useWorkspaceHref: () => ({
    workspaceHref: (path: string) => `/test-ws${path}`,
  }),
}));

vi.mock('@repo/types', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    PLAN_LABELS: { free: 'Free', pro: 'Pro', team: 'Team', enterprise: 'Enterprise' },
  };
});

// Import after mocks
import { FeatureGate } from '../feature-gate';
import { UpgradePrompt } from '../upgrade-prompt';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('FeatureGate', () => {
  beforeEach(() => {
    mockHasFeature = vi.fn().mockReturnValue(true);
    mockIsLoading = false;
  });

  it('renders children when feature is available', () => {
    mockHasFeature.mockReturnValue(true);

    render(
      <FeatureGate feature="task_management">
        <div data-testid="gated-content">Protected Content</div>
      </FeatureGate>,
    );

    expect(screen.getByTestId('gated-content')).toBeInTheDocument();
  });

  it('renders children while loading (prevents layout shift)', () => {
    mockIsLoading = true;
    mockHasFeature.mockReturnValue(false);

    render(
      <FeatureGate feature="analytics">
        <div data-testid="gated-content">Protected Content</div>
      </FeatureGate>,
    );

    expect(screen.getByTestId('gated-content')).toBeInTheDocument();
  });

  it('hides content in hide mode when feature unavailable', () => {
    mockHasFeature.mockReturnValue(false);

    render(
      <FeatureGate feature="analytics" mode="hide">
        <div data-testid="gated-content">Protected Content</div>
      </FeatureGate>,
    );

    expect(screen.queryByTestId('gated-content')).not.toBeInTheDocument();
  });

  it('renders fallback in hide mode when feature unavailable', () => {
    mockHasFeature.mockReturnValue(false);

    render(
      <FeatureGate
        feature="analytics"
        mode="hide"
        fallback={<div data-testid="fallback">Upgrade needed</div>}
      >
        <div data-testid="gated-content">Protected Content</div>
      </FeatureGate>,
    );

    expect(screen.queryByTestId('gated-content')).not.toBeInTheDocument();
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('shows lock overlay in disable mode when feature unavailable', () => {
    mockHasFeature.mockReturnValue(false);

    render(
      <FeatureGate feature="analytics" mode="disable">
        <div data-testid="gated-content">Protected Content</div>
      </FeatureGate>,
    );

    // Content is rendered but hidden (aria-hidden, pointer-events-none)
    const hiddenContent = screen.getByTestId('gated-content');
    expect(hiddenContent.closest('[aria-hidden="true"]')).toBeInTheDocument();

    // Lock overlay with plan name
    expect(screen.getByText(/Available on/)).toBeInTheDocument();
    expect(screen.getByText('View plans')).toBeInTheDocument();
  });

  it('defaults to disable mode', () => {
    mockHasFeature.mockReturnValue(false);

    render(
      <FeatureGate feature="analytics">
        <div>Content</div>
      </FeatureGate>,
    );

    // Should show lock overlay (disable mode default)
    expect(screen.getByText(/Available on/)).toBeInTheDocument();
  });
});

describe('UpgradePrompt', () => {
  beforeEach(() => {
    mockHasFeature = vi.fn().mockReturnValue(true);
    mockIsLoading = false;
  });

  it('renders nothing when feature is available', () => {
    mockHasFeature.mockReturnValue(true);

    const { container } = render(<UpgradePrompt feature="task_management" />);

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing while loading', () => {
    mockIsLoading = true;

    const { container } = render(<UpgradePrompt feature="analytics" />);

    expect(container.firstChild).toBeNull();
  });

  it('shows upgrade badge when feature unavailable', () => {
    mockHasFeature.mockReturnValue(false);

    render(<UpgradePrompt feature="analytics" />);

    expect(screen.getByText(/Available on/)).toBeInTheDocument();
  });

  it('supports custom label', () => {
    mockHasFeature.mockReturnValue(false);

    render(<UpgradePrompt feature="analytics" label="Unlock Analytics" />);

    expect(screen.getByText('Unlock Analytics')).toBeInTheDocument();
  });

  it('links to billing settings', () => {
    mockHasFeature.mockReturnValue(false);

    render(<UpgradePrompt feature="analytics" />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/test-ws/settings?tab=billing');
  });
});
