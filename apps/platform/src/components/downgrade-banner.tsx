'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, X } from 'lucide-react';
import { usePlan } from '@/hooks/use-plan';
import { useWorkspace } from '@/providers/workspace-provider';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';

interface UsageStatus {
  over_limit: boolean;
  details: { resource: string; current: number; limit: number }[];
}

const SESSION_KEY = 'downgrade_banner_dismissed';

/**
 * Banner shown when the workspace's resource usage exceeds the current plan limits.
 * This occurs after a downgrade — e.g. a user had 5 agents on Pro, downgraded to Free (limit: 2).
 * Existing resources are preserved (read-only) but new creation is blocked.
 *
 * Dismissible per session; reappears on next visit.
 */
export function DowngradeBanner() {
  const { activeWorkspace } = useWorkspace();
  const { plan, limits, isLoading: planLoading, isPlatformOwner } = usePlan();
  const { workspaceHref } = useWorkspaceHref();
  const [usageStatus, setUsageStatus] = useState<UsageStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem(SESSION_KEY)) {
      setDismissed(true);
    }
  }, []);

  useEffect(() => {
    if (!activeWorkspace?.id || planLoading || isPlatformOwner) return;

    let cancelled = false;

    fetchJson<UsageStatus>(
      apiUrl(`/api/workspaces/usage-status?workspace_id=${activeWorkspace.id}`),
    )
      .then((data) => {
        if (!cancelled && data) setUsageStatus(data);
      })
      .catch(() => {
        // Fail silently — don't block the UI
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.id, planLoading, isPlatformOwner]);

  if (dismissed || isPlatformOwner || !usageStatus?.over_limit) return null;

  function handleDismiss() {
    sessionStorage.setItem(SESSION_KEY, '1');
    setDismissed(true);
  }

  return (
    <div
      role="alert"
      className="border-warning/20 bg-warning/10 text-warning flex items-center gap-3 border-b px-4 py-2 text-sm"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">
        Some features are limited on your current plan. Existing data is preserved but new creation
        may be restricted.
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href={workspaceHref('/settings?tab=integrations')}
          className="text-warning hover:text-warning/80 shrink-0 text-xs font-medium underline underline-offset-2 transition-colors"
        >
          Use your own key
        </Link>
        <span className="text-warning/50 text-xs">or</span>
        <Link
          href={workspaceHref('/settings?tab=billing')}
          className="border-warning/30 bg-warning/10 text-warning hover:bg-warning/20 flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1 text-xs font-medium transition-colors"
        >
          Upgrade <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="text-warning hover:bg-warning/10 shrink-0 rounded-md p-2 transition-colors"
        aria-label="Dismiss downgrade warning"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
