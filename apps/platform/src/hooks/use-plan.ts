'use client';

import { useContext } from 'react';
import { PlanContext } from '@/providers/plan-provider';

/**
 * Returns the current workspace's plan data from the PlanProvider context.
 * Plan data is fetched once by the provider and shared across all consumers.
 * Cached in localStorage to prevent flash of wrong tier on page load.
 */
export function usePlan() {
  return useContext(PlanContext);
}
