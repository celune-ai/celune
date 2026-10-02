/**
 * What the app shell shows: Cloud is paid from day one, so an unpaid org pays before
 * onboarding. Onboarding starts once the plan is active, or at once for Enterprise, the
 * platform owner, and the community edition (none of which resolve to unpaid).
 */
export type ShellPhase = 'wait' | 'paywall' | 'onboarding' | 'app';

export interface ShellPhaseInput {
  planLoading: boolean;
  onboardingLoading: boolean;
  isUnpaid: boolean;
  isPlatformOwner: boolean;
  /** Onboarding is incomplete for this user. */
  onboardingPending: boolean;
  /** The user closed the wizard this session. */
  onboardingDismissed: boolean;
}

export function shellPhase(input: ShellPhaseInput): ShellPhase {
  if (input.planLoading) return 'wait';
  // The paywall comes first: onboarding's AI steps need a plan (the host key is paywalled).
  if (input.isUnpaid && !input.isPlatformOwner) return 'paywall';
  if (input.onboardingLoading) return 'wait';
  if (input.onboardingPending && !input.onboardingDismissed) return 'onboarding';
  return 'app';
}
