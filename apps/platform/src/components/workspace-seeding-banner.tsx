'use client';

import { useEffect, useState, useRef } from 'react';
import { Loader2, Sparkles, CheckCircle2 } from 'lucide-react';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';

/**
 * Shown on the workspace dashboard when onboarding content is still being
 * seeded in the background. Polls for projects every 3 seconds and
 * auto-dismisses once content appears or after 60 seconds (whichever first).
 *
 * Only renders if the workspace was created in the last 60 seconds AND has
 * 0 projects — prevents showing on repeat visits.
 */
export function WorkspaceSeedingBanner({ onSeedingComplete }: { onSeedingComplete?: () => void }) {
  const { activeWorkspace } = useWorkspace();
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeWorkspace?.id) return;

    // Only show if workspace was created in the last 60 seconds
    const createdAt = activeWorkspace.created_at
      ? new Date(activeWorkspace.created_at).getTime()
      : 0;
    const now = Date.now();
    const isNew = now - createdAt < 60_000;
    if (!isNew) return;

    let cancelled = false;

    // Check if workspace already has projects
    async function checkProjects(): Promise<boolean> {
      try {
        const projects = await fetchJson<unknown[]>(
          apiUrl(`/api/projects?workspace_id=${activeWorkspace!.id}`),
        );
        return Array.isArray(projects) && projects.length > 0;
      } catch {
        return false;
      }
    }

    // Initial check
    checkProjects().then((hasProjects) => {
      if (cancelled) return;
      if (hasProjects) {
        // Already seeded — don't show banner
        return;
      }

      // Show the banner
      setVisible(true);

      // Poll every 3s
      pollRef.current = setInterval(async () => {
        const ready = await checkProjects();
        if (ready && !cancelled) {
          setDone(true);
          onSeedingComplete?.();
          if (pollRef.current) clearInterval(pollRef.current);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          // Hide after showing "done" for 2s
          setTimeout(() => {
            if (!cancelled) setVisible(false);
          }, 2000);
        }
      }, 3000);

      // Auto-dismiss after 60s regardless
      timeoutRef.current = setTimeout(() => {
        if (!cancelled) {
          setVisible(false);
          onSeedingComplete?.();
        }
        if (pollRef.current) clearInterval(pollRef.current);
      }, 60_000);
    });

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [activeWorkspace?.id, activeWorkspace?.created_at, onSeedingComplete]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-brand/20 bg-brand/5 mb-6 flex items-center gap-3 rounded-lg border p-4"
    >
      {done ? (
        <>
          <CheckCircle2 className="text-brand h-5 w-5 shrink-0" />
          <div>
            <p className="text-foreground text-sm font-medium">Workspace ready</p>
            <p className="text-muted-foreground text-xs">
              Your starter projects and tasks have been created.
            </p>
          </div>
        </>
      ) : (
        <>
          <Loader2 className="text-brand h-5 w-5 shrink-0 animate-spin" />
          <div>
            <p className="text-foreground text-sm font-medium">Setting up your workspace...</p>
            <p className="text-muted-foreground text-xs">
              Creating your starter projects and tasks. This usually takes a few seconds.
            </p>
          </div>
          <Sparkles className="text-brand/40 ml-auto h-4 w-4 shrink-0" />
        </>
      )}
    </div>
  );
}
