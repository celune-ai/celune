/**
 * @vitest-environment jsdom
 *
 * /subscribe: focus lands on the heading after a paywall redirect, and a user
 * with no workspace sees that state instead of a spinner.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/settings/cloud-checkout', () => ({
  CloudCheckout: () => <div>checkout</div>,
}));

let plan = {
  isUnpaid: true,
  isWorkspaceOwner: true,
  isPlatformOwner: false,
  isLoading: false,
  hasNoWorkspace: false,
};
vi.mock('@/hooks/use-plan', () => ({ usePlan: () => plan }));

import SubscribePage from '../page';

beforeEach(() => {
  replace.mockClear();
  plan = {
    isUnpaid: true,
    isWorkspaceOwner: true,
    isPlatformOwner: false,
    isLoading: false,
    hasNoWorkspace: false,
  };
});

describe('/subscribe', () => {
  it('moves focus to the heading', () => {
    render(<SubscribePage />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Subscribe to Celune Cloud');
    expect(document.activeElement).toBe(heading);
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows the no-workspace state instead of loading', () => {
    plan = { ...plan, isUnpaid: false, hasNoWorkspace: true };
    render(<SubscribePage />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('No workspace yet');
    expect(document.activeElement).toBe(heading);
    expect(replace).not.toHaveBeenCalled();
  });

  it('sends an org with a plan home', () => {
    plan = { ...plan, isUnpaid: false };
    render(<SubscribePage />);
    expect(replace).toHaveBeenCalledWith('/');
  });
});
