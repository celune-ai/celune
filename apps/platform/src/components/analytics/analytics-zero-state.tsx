'use client';

import { BarChart3, Clock, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';

interface AnalyticsZeroStateProps {
  /** Days since workspace was created */
  daysSinceCreation: number;
  /** Date when analytics will be available */
  availableDate: string;
}

/**
 * Zero state shown for new workspaces (< 7 days old).
 * Displays empty card shells with a message about when analytics will be available.
 */
export function AnalyticsZeroState({ daysSinceCreation, availableDate }: AnalyticsZeroStateProps) {
  const { workspaceHref } = useWorkspaceHref();
  const daysRemaining = Math.max(0, 7 - daysSinceCreation);
  const progress = Math.min(100, (daysSinceCreation / 7) * 100);

  return (
    <div className="flex-1 px-6 py-10">
      {/* Hero message */}
      <div className="mx-auto max-w-2xl text-center">
        <div className="bg-surface-200 mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full">
          <BarChart3 className="text-foreground-muted h-7 w-7" />
        </div>

        <h2 className="text-foreground text-2xl font-semibold">Your analytics are on the way</h2>
        <p className="text-foreground-lighter mt-3 text-base leading-relaxed">
          We need about a week of usage data to show meaningful insights. Keep using your workspace
          and check back soon.
        </p>

        {/* Progress */}
        <div className="mx-auto mt-8 max-w-sm">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-foreground-muted flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Day {daysSinceCreation} of 7
            </span>
            <span className="text-foreground-muted">Available {availableDate}</span>
          </div>
          <div className="bg-surface-300 h-1.5 w-full overflow-hidden rounded-full">
            <div
              className="bg-brand h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-foreground-muted mt-2 text-xs">
            {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} remaining
          </p>
        </div>
      </div>

      {/* Empty metric cards */}
      <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Tasks Created', value: '—' },
          { label: 'Agent Activity', value: '—' },
          { label: 'API Calls', value: '—' },
          { label: 'Memory Entries', value: '—' },
        ].map((card) => (
          <div key={card.label} className="border-border bg-surface-75 rounded-lg border p-5">
            <p className="text-foreground-muted text-xs">{card.label}</p>
            <p className="text-foreground mt-1 text-2xl font-semibold opacity-20">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Quick links */}
      <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3">
        <p className="text-foreground-muted text-xs">In the meantime:</p>
        <div className="flex gap-3">
          <Link
            href={workspaceHref('/projects')}
            className="text-foreground-lighter hover:text-foreground flex items-center gap-1.5 rounded-md border border-white/10 px-3 py-1.5 text-xs transition-colors hover:bg-white/5"
          >
            Explore projects <ArrowRight className="h-3 w-3" />
          </Link>
          <Link
            href={workspaceHref('/agents')}
            className="text-foreground-lighter hover:text-foreground flex items-center gap-1.5 rounded-md border border-white/10 px-3 py-1.5 text-xs transition-colors hover:bg-white/5"
          >
            Meet your agents <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
