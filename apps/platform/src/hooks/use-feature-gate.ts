'use client';

import { usePlan } from '@/hooks/use-plan';
import { PLAN_TIERS } from '@repo/types';
import type { Plan } from '@repo/types';

/**
 * Map a feature to the minimum plan that includes it.
 * Used to show "Available on Enterprise" in upgrade prompts.
 */
const PLAN_ORDER: Plan[] = ['cloud', 'enterprise'];

function getMinimumPlan(feature: string): Plan {
  for (const plan of PLAN_ORDER) {
    const tier = PLAN_TIERS[plan];
    if (tier?.features.includes(feature)) {
      return plan;
    }
  }
  return 'enterprise';
}

/**
 * Check whether a specific feature is available on the current workspace plan.
 *
 * Returns:
 * - `available` — true if the feature is included in the plan
 * - `requiredPlan` — the minimum plan that includes this feature (e.g. 'enterprise')
 * - `loading` — true while the plan data is being fetched
 */
export function useFeatureGate(feature: string) {
  const { hasFeature, isLoading } = usePlan();

  return {
    available: hasFeature(feature),
    requiredPlan: getMinimumPlan(feature),
    loading: isLoading,
  };
}
