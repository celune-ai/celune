'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { PLAN_LABELS } from '@repo/types';
import type { Plan } from '@repo/types';

interface UpgradePromptProps {
  /** Feature key to check (e.g. 'analytics', 'voice') */
  feature: string;
  /** Optional override for the label text */
  label?: string;
  /** Size variant */
  size?: 'sm' | 'md';
}

/**
 * Small inline upgrade prompt — lock icon + "Available on Pro" link.
 * Only renders when the feature is NOT available on the current plan.
 *
 * ```tsx
 * <UpgradePrompt feature="analytics" />
 * // → 🔒 Available on Pro
 * ```
 */
export function UpgradePrompt({ feature, label, size = 'sm' }: UpgradePromptProps) {
  const { available, requiredPlan, loading } = useFeatureGate(feature);
  const { workspaceHref } = useWorkspaceHref();

  if (loading || available) return null;

  const planLabel = PLAN_LABELS[requiredPlan as Plan] ?? requiredPlan;
  const text = label ?? `Available on ${planLabel}`;

  const sizeClasses = size === 'sm' ? 'gap-1 text-xs px-2 py-0.5' : 'gap-1.5 text-sm px-3 py-1';
  const iconSize = size === 'sm' ? 12 : 14;

  return (
    <Link
      href={workspaceHref('/settings?tab=billing')}
      className={`text-foreground-muted hover:text-foreground border-border inline-flex items-center rounded-full border transition-colors ${sizeClasses}`}
    >
      <Lock size={iconSize} className="shrink-0" />
      <span>{text}</span>
    </Link>
  );
}
