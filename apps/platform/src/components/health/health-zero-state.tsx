'use client';

import { CollectingZeroState } from '@/components/collecting-zero-state';

/**
 * Zero state for the Health dashboard tab.
 * Shown when the workspace is new (< 7 days) or has no meaningful analytics data.
 */
export function HealthZeroState() {
  return (
    <CollectingZeroState
      title="Your health dashboard is warming up"
      description="Agent health metrics, velocity trends, and utilization data will appear here after your team has been active for about a week."
    />
  );
}
