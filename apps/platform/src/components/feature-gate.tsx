'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { PLAN_LABELS } from '@repo/types';
import type { Plan } from '@repo/types';

interface FeatureGateProps {
  /** Feature key to check against the plan (e.g. 'analytics', 'voice') */
  feature: string;
  children: ReactNode;
  /**
   * - `"hide"` — don't render children at all
   * - `"disable"` — render children with reduced opacity, pointer-events-none,
   *   and a lock overlay with upgrade prompt (default)
   */
  mode?: 'hide' | 'disable';
  /** Optional fallback to render when gated in hide mode */
  fallback?: ReactNode;
}

/**
 * Conditionally render or disable UI based on plan features.
 *
 * ```tsx
 * <FeatureGate feature="analytics" mode="disable">
 *   <AnalyticsDashboard />
 * </FeatureGate>
 *
 * <FeatureGate feature="voice" mode="hide">
 *   <VoiceSettings />
 * </FeatureGate>
 * ```
 */
export function FeatureGate({ feature, children, mode = 'disable', fallback }: FeatureGateProps) {
  const { available, requiredPlan, loading } = useFeatureGate(feature);
  const { workspaceHref } = useWorkspaceHref();

  // While loading, render children to avoid layout shift
  if (loading || available) {
    return <>{children}</>;
  }

  if (mode === 'hide') {
    return fallback ? <>{fallback}</> : null;
  }

  // mode === 'disable'
  const planLabel = PLAN_LABELS[requiredPlan as Plan] ?? requiredPlan;

  return (
    <div className="relative">
      <div
        className="pointer-events-none opacity-40 blur-[1px] select-none"
        aria-hidden="true"
        inert
      >
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="bg-surface-100 border-border flex flex-col items-center gap-2 rounded-lg border px-6 py-4 shadow-lg">
          <Lock size={20} className="text-foreground-muted" />
          <p className="text-foreground text-sm font-medium">Available on {planLabel}</p>
          <Link
            href={workspaceHref('/settings?tab=billing')}
            className="bg-brand text-brand-foreground hover:bg-brand/90 rounded-md px-4 py-1.5 text-xs font-medium transition-colors"
          >
            View plans
          </Link>
        </div>
      </div>
    </div>
  );
}
