'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { usePlan } from '@/hooks/use-plan';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';

interface UpgradeGateProps {
  feature: string;
  children: ReactNode;
  /** Label shown when gated. Defaults to "Upgrade to unlock" */
  label?: string;
}

/**
 * Wraps a section that requires a specific plan feature.
 * If the current plan includes the feature, renders children normally.
 * Otherwise, shows a locked overlay with an upgrade CTA.
 */
export function UpgradeGate({ feature, children, label }: UpgradeGateProps) {
  const { hasFeature, isLoading } = usePlan();
  const { workspaceHref } = useWorkspaceHref();

  if (isLoading || hasFeature(feature)) {
    return <>{children}</>;
  }

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
          <p className="text-foreground text-sm font-medium">{label ?? 'Upgrade to unlock'}</p>
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
