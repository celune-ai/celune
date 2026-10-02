import { describe, it, expect } from 'vitest';
import { shellPhase, type ShellPhaseInput } from '../shell-phase';

const base: ShellPhaseInput = {
  planLoading: false,
  onboardingLoading: false,
  isUnpaid: false,
  isPlatformOwner: false,
  onboardingPending: true,
  onboardingDismissed: false,
};

describe('shellPhase (pay before onboarding)', () => {
  it('sends a new unpaid owner to the paywall before onboarding', () => {
    expect(shellPhase({ ...base, isUnpaid: true })).toBe('paywall');
  });

  it('decides the paywall even while onboarding state is still loading', () => {
    expect(shellPhase({ ...base, isUnpaid: true, onboardingLoading: true })).toBe('paywall');
  });

  it('waits for the plan before opening onboarding', () => {
    expect(shellPhase({ ...base, planLoading: true })).toBe('wait');
  });

  it('starts onboarding once the plan is active', () => {
    expect(shellPhase(base)).toBe('onboarding');
  });

  it('lets the platform owner onboard without a subscription', () => {
    expect(shellPhase({ ...base, isUnpaid: true, isPlatformOwner: true })).toBe('onboarding');
  });

  it('shows the app when onboarding is done or dismissed', () => {
    expect(shellPhase({ ...base, onboardingPending: false })).toBe('app');
    expect(shellPhase({ ...base, onboardingDismissed: true })).toBe('app');
  });
});
