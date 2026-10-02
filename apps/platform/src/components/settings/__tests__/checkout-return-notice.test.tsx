/**
 * @vitest-environment jsdom
 *
 * CheckoutReturnNotice: activating, delayed, active, and canceled states after Stripe Checkout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let search = '';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

let plan = { isLoading: false, isUnpaid: false };
vi.mock('@/hooks/use-plan', () => ({ usePlan: () => plan }));

import { CheckoutReturnNotice } from '../checkout-return-notice';

beforeEach(() => {
  search = '';
  plan = { isLoading: false, isUnpaid: false };
});

describe('CheckoutReturnNotice', () => {
  it('renders nothing without a checkout marker', () => {
    const { container } = render(<CheckoutReturnNotice />);
    expect(container.textContent).toBe('');
  });

  it('says the payment is activating while the plan loads', () => {
    search = 'success=1';
    plan = { isLoading: true, isUnpaid: false };
    render(<CheckoutReturnNotice />);
    expect(screen.getByRole('status').textContent).toContain('Activating your subscription');
  });

  it('confirms an active subscription', () => {
    search = 'success=1';
    render(<CheckoutReturnNotice />);
    expect(screen.getByRole('status').textContent).toContain('subscription is active');
  });

  it('warns when Stripe has not confirmed after polling', () => {
    search = 'success=1';
    plan = { isLoading: false, isUnpaid: true };
    render(<CheckoutReturnNotice />);
    expect(screen.getByRole('alert').textContent).toContain('Stripe has not confirmed');
  });

  it('says a canceled checkout charged nothing', () => {
    search = 'canceled=1';
    render(<CheckoutReturnNotice />);
    expect(screen.getByRole('status').textContent).toContain('You have not been charged');
  });
});
