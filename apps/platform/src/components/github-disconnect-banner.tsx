'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Github, X } from 'lucide-react';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { useWorkspace } from '@/providers/workspace-provider';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';

/**
 * Banner shown when the workspace's GitHub connection has been removed or
 * the org installation is no longer active.
 *
 * Checks /api/github/installations for the current org. Shows a warning
 * banner with a link to reconnect only when the org connected GitHub before
 * and has no active installation now.
 */
export function GitHubDisconnectBanner() {
  const { workspaceHref } = useWorkspaceHref();
  const { activeWorkspace } = useWorkspace();
  const [disconnected, setDisconnected] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!activeWorkspace?.id) return;

    const key = `github-banner-dismissed-${activeWorkspace.id}`;
    if (sessionStorage.getItem(key)) {
      setChecked(true);
      return;
    }

    let cancelled = false;

    function checkConnection() {
      fetchJson<{
        installations: { id: number; is_active?: boolean }[];
        had_installation?: boolean;
      }>(apiUrl(`/api/github/installations?workspace_id=${activeWorkspace!.id}`))
        .then((data) => {
          if (cancelled) return;
          const hasActive = data.installations.length > 0;
          // A workspace that never connected GitHub has nothing to reconnect.
          setDisconnected(!hasActive && data.had_installation === true);
          // Auto-dismiss when connection comes back
          if (hasActive && checked) {
            setDismissed(true);
            sessionStorage.setItem(key, '1');
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setChecked(true);
        });
    }

    checkConnection();
    // Re-check every 15s so banner auto-clears when GitHub reconnects
    const interval = setInterval(checkConnection, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeWorkspace?.id, checked]);

  if (!checked || !disconnected || dismissed) return null;

  function handleDismiss() {
    setDismissed(true);
    if (activeWorkspace?.id) {
      sessionStorage.setItem(`github-banner-dismissed-${activeWorkspace.id}`, '1');
    }
  }

  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-400"
    >
      <Github className="h-4 w-4 shrink-0" />
      <span className="flex-1">
        GitHub connection has been removed. Reconnect to enable native GitHub features.
      </span>
      <Link
        href={workspaceHref('/settings?tab=integrations#github')}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/20"
      >
        Review
      </Link>
      <button
        onClick={handleDismiss}
        className="shrink-0 rounded p-0.5 text-amber-400/50 transition-colors hover:text-amber-400"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
