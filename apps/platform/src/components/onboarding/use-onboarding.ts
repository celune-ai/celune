'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@repo/db/client';

interface OnboardingState {
  shouldShow: boolean;
  isBlocked: boolean;
  loading: boolean;
}

/**
 * Checks user_metadata flags to determine onboarding state.
 * - shouldShow: true when onboarding_completed is not set
 * - isBlocked: true when onboarding was started but not completed
 */
export function useOnboarding(): OnboardingState {
  const [state, setState] = useState<OnboardingState>({
    shouldShow: false,
    isBlocked: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          if (!cancelled) setState({ shouldShow: false, isBlocked: false, loading: false });
          return;
        }

        const meta = user.user_metadata ?? {};
        const completed = !!meta.onboarding_completed;
        const started = !!meta.onboarding_started;

        if (!cancelled) {
          setState({
            shouldShow: !completed,
            isBlocked: started && !completed,
            loading: false,
          });
        }
      } catch {
        if (!cancelled) setState({ shouldShow: false, isBlocked: false, loading: false });
      }
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/**
 * Sets onboarding_started in user_metadata (user passed welcome step).
 */
export async function markOnboardingStarted(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.updateUser({ data: { onboarding_started: true } });
}

/**
 * Marks onboarding as completed in user_metadata so it won't show again.
 */
export async function markOnboardingComplete(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.updateUser({ data: { onboarding_completed: true } });
}
