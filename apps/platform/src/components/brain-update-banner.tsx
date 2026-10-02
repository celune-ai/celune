'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { RefreshCw, AlertTriangle, X } from 'lucide-react';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';

const SESSION_KEY = 'brain_update_banner_dismissed';
const CACHE_KEY = 'brain_update_banner_data';

interface GroupedCounts {
  core: number;
  github: number;
  slack: number;
  voice: number;
  byok: number;
}

interface BrainUpdateItem {
  path: string;
  integration_group?: string | null;
}

interface BrainUpdatesApiResponse {
  up_to_date: boolean;
  pending: BrainUpdateItem[];
  forked_updates: BrainUpdateItem[];
  new_files: BrainUpdateItem[];
  grouped_counts?: GroupedCounts;
}

interface BrainUpdatesResponse {
  up_to_date: boolean;
  pending_count: number;
  forked_count: number;
  grouped_counts: GroupedCounts | null;
}

const GROUP_LABELS: Record<string, string> = {
  core: 'Core',
  github: 'GitHub',
  slack: 'Slack',
  voice: 'Voice',
  byok: 'AI Providers',
};

function formatBannerMessage(data: BrainUpdatesResponse): string {
  const totalCount = data.pending_count + data.forked_count;

  // Build grouped breakdown if available
  if (data.grouped_counts) {
    const parts: string[] = [];
    for (const [key, count] of Object.entries(data.grouped_counts)) {
      if (count > 0) parts.push(`${GROUP_LABELS[key] ?? key}: ${count}`);
    }
    if (parts.length > 1) {
      const breakdown = parts.join(' \u00B7 ');
      const forkedSuffix = data.forked_count > 0 ? ` (${data.forked_count} forked)` : '';
      return `${totalCount} brain update${totalCount !== 1 ? 's' : ''} available \u2014 ${breakdown}${forkedSuffix}`;
    }
  }

  // Fallback: flat count
  if (data.forked_count > 0 && data.pending_count > 0) {
    return `${data.pending_count} brain update${data.pending_count !== 1 ? 's' : ''} available \u00B7 ${data.forked_count} forked file${data.forked_count !== 1 ? 's' : ''} have updates`;
  }
  if (data.forked_count > 0) {
    return `${data.forked_count} forked file${data.forked_count !== 1 ? 's' : ''} have updates available`;
  }
  return `${data.pending_count} brain update${data.pending_count !== 1 ? 's' : ''} available`;
}

/**
 * Info/warning banner shown when brain manifest updates are available.
 * Dismissible per session; reappears on the next visit.
 * Shown on all authenticated pages via AdminLayout.
 */
export function BrainUpdateBanner() {
  const { activeWorkspace, isLoading: wsLoading } = useWorkspace();
  const { workspaceHref } = useWorkspaceHref();
  const [data, setData] = useState<BrainUpdatesResponse | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem(SESSION_KEY)) {
      setDismissed(true);
      return;
    }

    // Check for cached response first
    if (typeof window !== 'undefined') {
      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          setData(JSON.parse(cached));
          return;
        }
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  useEffect(() => {
    if (wsLoading || !activeWorkspace || dismissed) return;

    // Skip fetch if we already have cached data
    if (data) return;

    let cancelled = false;

    fetchJson<BrainUpdatesApiResponse>(`/api/brain/updates?workspace_id=${activeWorkspace.id}`)
      .then((apiRes) => {
        if (!cancelled) {
          // Only count actual updates (pending + forked), NOT new_files.
          // New files are initial seeds handled by the onboarding "Review
          // your memories" step — showing them here is noise.
          const updates = [...apiRes.pending, ...apiRes.forked_updates];
          const grouped: GroupedCounts = { core: 0, github: 0, slack: 0, voice: 0, byok: 0 };
          for (const item of updates) {
            const key = (item.integration_group ?? 'core') as keyof GroupedCounts;
            if (key in grouped) grouped[key]++;
          }
          const res: BrainUpdatesResponse = {
            up_to_date: updates.length === 0,
            pending_count: apiRes.pending.length,
            forked_count: apiRes.forked_updates.length,
            grouped_counts: updates.length > 0 ? grouped : null,
          };
          setData(res);
          try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify(res));
          } catch {
            // sessionStorage may be unavailable
          }
        }
      })
      .catch(() => {
        // Fail silently — don't block the UI on a brain update check failure
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspace, wsLoading, dismissed, data]);

  function handleDismiss() {
    sessionStorage.setItem(SESSION_KEY, '1');
    setDismissed(true);
  }

  if (dismissed || !data || data.up_to_date) return null;

  const hasForked = data.forked_count > 0;
  const hasPending = data.pending_count > 0;

  // Show nothing if there are somehow zero of both
  if (!hasForked && !hasPending) return null;

  // Warning variant for forked files, info variant for standard updates
  const isWarning = hasForked;

  return (
    <div
      role="status"
      className={
        isWarning
          ? 'border-warning/20 bg-warning/10 text-warning flex items-center gap-3 border-b px-4 py-2 text-sm'
          : 'border-brand/20 bg-brand/10 text-brand flex items-center gap-3 border-b px-4 py-2 text-sm'
      }
    >
      {isWarning ? (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      ) : (
        <RefreshCw className="h-4 w-4 shrink-0" />
      )}
      <Link
        href={workspaceHref('/skills?status=update-available')}
        className="flex-1 underline decoration-current/30 underline-offset-2 hover:decoration-current/60"
      >
        {formatBannerMessage(data)}
      </Link>
      <button
        type="button"
        onClick={handleDismiss}
        className={
          isWarning
            ? 'hover:bg-warning/10 focus-visible:ring-ring shrink-0 rounded-md p-2 transition-colors focus-visible:ring-2 focus-visible:outline-none'
            : 'hover:bg-brand/10 focus-visible:ring-ring shrink-0 rounded-md p-2 transition-colors focus-visible:ring-2 focus-visible:outline-none'
        }
        aria-label="Dismiss brain update notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
