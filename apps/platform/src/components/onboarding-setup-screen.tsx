'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bot, FolderKanban } from 'lucide-react';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GenerationStatus {
  status: 'none' | 'pending' | 'complete' | 'error';
  pending: boolean;
  completed_at: string | null;
  project_ids: string[];
  error: string | null;
}

// ---------------------------------------------------------------------------
// Bouncing dots loader
// ---------------------------------------------------------------------------

function BouncingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="bg-brand h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:0ms]" />
      <span className="bg-brand h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:150ms]" />
      <span className="bg-brand h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:300ms]" />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Inline setup cards shown at the top of the dashboard after onboarding.
 * Two cards: "Explore your projects" and "Meet your agent team".
 * Shows loading state while generation runs, green buttons once complete.
 * Dismissed when the user clicks through to projects or agents.
 */
export function OnboardingSetupScreen() {
  const { activeWorkspace } = useWorkspace();
  const { workspaceHref } = useWorkspaceHref();
  const workspaceId = activeWorkspace?.id;

  const [visible, setVisible] = useState(false);
  const [complete, setComplete] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initializedRef = useRef(false);

  // Initialize — show immediately if localStorage flag is set (no async wait)
  useEffect(() => {
    if (!workspaceId || initializedRef.current) return;

    const dismissKey = `onboarding_setup_dismissed_${workspaceId}`;
    if (localStorage.getItem(dismissKey) === 'true') return;

    const localPending =
      localStorage.getItem(`onboarding_generation_pending_${workspaceId}`) === 'true';

    // Debug: trace why cards might not show
    console.log('[setup-screen] init', {
      workspaceId,
      localPending,
      dismissKey,
      dismissed: localStorage.getItem(`onboarding_setup_dismissed_${workspaceId}`),
    });

    // Show cards immediately if the pending flag is set — don't wait for API
    if (localPending) {
      initializedRef.current = true;
      setVisible(true);
      // Still check API to see if it already completed
      fetchJson<GenerationStatus>(
        apiUrl(`/api/onboarding/generate-projects?workspace_id=${workspaceId}`),
      )
        .then((data) => {
          if (data.status === 'complete') {
            setComplete(true);
            localStorage.removeItem(`onboarding_generation_pending_${workspaceId}`);
          }
        })
        .catch(() => {});
      return;
    }

    // No localStorage flag — check API for status (returning user, or flag was cleared)
    fetchJson<GenerationStatus>(
      apiUrl(`/api/onboarding/generate-projects?workspace_id=${workspaceId}`),
    )
      .then((data) => {
        if (data.status === 'pending') {
          initializedRef.current = true;
          setVisible(true);
        } else if (data.status === 'complete') {
          initializedRef.current = true;
          setVisible(true);
          setComplete(true);
        }
        // 'none' or 'error' without localStorage flag → don't show
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Poll for generation completion
  useEffect(() => {
    if (!visible || complete || !workspaceId) return;

    pollRef.current = setInterval(() => {
      fetchJson<GenerationStatus>(
        apiUrl(`/api/onboarding/generate-projects?workspace_id=${workspaceId}`),
      )
        .then((data) => {
          if (data.status === 'complete' || data.status === 'error') {
            setComplete(true);
            localStorage.removeItem(`onboarding_generation_pending_${workspaceId}`);
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
          }
        })
        .catch(() => {});
    }, 3000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [visible, complete, workspaceId]);

  // Dismiss permanently when user clicks through
  function handleDismiss() {
    if (workspaceId) {
      localStorage.setItem(`onboarding_setup_dismissed_${workspaceId}`, 'true');
      localStorage.removeItem(`onboarding_generation_pending_${workspaceId}`);
    }
  }

  if (!visible) return null;

  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-2">
      {/* Explore your projects */}
      <div className="border-border bg-surface-75 flex flex-col items-start gap-3 rounded-lg border p-5">
        <FolderKanban size={20} className="text-brand" strokeWidth={1.5} />
        <div>
          <p className="text-foreground text-sm font-semibold">Explore your projects</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Personalized projects created from your onboarding conversation.
          </p>
        </div>
        {complete ? (
          <Link
            href={workspaceHref('/projects')}
            onClick={handleDismiss}
            className="bg-brand hover:bg-brand/80 mt-1 inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium text-black transition-colors"
          >
            View projects
          </Link>
        ) : (
          <div className="text-brand mt-1 flex items-center gap-2 text-sm font-medium">
            <BouncingDots />
            <span>Agent is working&hellip;</span>
          </div>
        )}
      </div>

      {/* Meet your agent team */}
      <div className="border-border bg-surface-75 flex flex-col items-start gap-3 rounded-lg border p-5">
        <Bot size={20} className="text-brand" strokeWidth={1.5} />
        <div>
          <p className="text-foreground text-sm font-semibold">Meet your agent team</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            AI agents configured to help with your specific workflows.
          </p>
        </div>
        {complete ? (
          <Link
            href={workspaceHref('/agents')}
            onClick={handleDismiss}
            className="bg-brand hover:bg-brand/80 mt-1 inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium text-black transition-colors"
          >
            Meet the team
          </Link>
        ) : (
          <div className="text-brand mt-1 flex items-center gap-2 text-sm font-medium">
            <BouncingDots />
            <span>Agent is working&hellip;</span>
          </div>
        )}
      </div>
    </div>
  );
}
