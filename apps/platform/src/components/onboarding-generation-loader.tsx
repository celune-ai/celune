'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';

// ---------------------------------------------------------------------------
// Progressive status messages shown during generation
// ---------------------------------------------------------------------------

const STATUS_MESSAGES = [
  { text: 'Analyzing your conversation...', durationMs: 3000 },
  { text: 'Understanding your goals...', durationMs: 3000 },
  { text: 'Generating personalized projects...', durationMs: 6000 },
  { text: 'Creating tasks for your first sprint...', durationMs: 6000 },
];

interface GenerationStatus {
  status: 'none' | 'pending' | 'complete' | 'error';
  pending: boolean;
  completed_at: string | null;
  project_ids: string[];
  error: string | null;
}

/**
 * Shows a loading card on the dashboard while onboarding projects are being
 * generated. Polls the generation status endpoint and displays progressive
 * status messages. On completion, shows a CTA to view projects.
 *
 * Renders null when:
 * - Generation hasn't been triggered (status === 'none' and not pending)
 * - Generation was already completed and dismissed
 */
export function OnboardingGenerationLoader() {
  const { activeWorkspace } = useWorkspace();
  const { workspaceHref } = useWorkspaceHref();
  const [status, setStatus] = useState<GenerationStatus | null>(null);
  const [messageIndex, setMessageIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [generationTriggered, setGenerationTriggered] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const workspaceId = activeWorkspace?.id;

  // Check if this loader was already dismissed
  useEffect(() => {
    if (!workspaceId) return;
    const dismissKey = `onboarding_generation_dismissed_${workspaceId}`;
    if (localStorage.getItem(dismissKey) === 'true') {
      setDismissed(true);
    }
  }, [workspaceId]);

  // Fetch initial status
  useEffect(() => {
    if (!workspaceId || dismissed) return;

    // Check localStorage flag set by onboarding before the POST fires.
    // This bridges the race condition where the dashboard loads before
    // the POST has set 'pending' in workspace metadata.
    const localPending =
      localStorage.getItem(`onboarding_generation_pending_${workspaceId}`) === 'true';

    fetchJson<GenerationStatus>(
      apiUrl(`/api/onboarding/generate-projects?workspace_id=${workspaceId}`),
    )
      .then((data) => {
        // If API says 'none' but localStorage says pending, override
        if (data.status === 'none' && localPending) {
          setStatus({ ...data, status: 'pending', pending: true });
        } else {
          setStatus(data);
          // Clean up localStorage flag once API has caught up
          if (localPending && data.status !== 'none') {
            localStorage.removeItem(`onboarding_generation_pending_${workspaceId}`);
          }
        }
      })
      .catch(() => {
        // If the endpoint fails but localStorage says pending, still show loader
        if (localPending) {
          setStatus({
            status: 'pending',
            pending: true,
            completed_at: null,
            project_ids: [],
            error: null,
          });
        } else {
          setStatus({
            status: 'none',
            pending: false,
            completed_at: null,
            project_ids: [],
            error: null,
          });
        }
      });
  }, [workspaceId, dismissed]);

  // Trigger project generation if pending and not yet triggered
  useEffect(() => {
    if (!workspaceId || !status || generationTriggered) return;
    if (status.pending && status.status !== 'complete') {
      setGenerationTriggered(true);
      fetch(apiUrl('/api/onboarding/generate-projects'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId }),
      }).catch((err) => {
        console.error('[OnboardingGenerationLoader] Failed to trigger generation:', err);
      });
    }
  }, [workspaceId, status, generationTriggered]);

  // Poll for status while pending
  useEffect(() => {
    if (!workspaceId || dismissed) return;
    if (status?.status === 'complete' || status?.status === 'error' || status?.status === 'none') {
      return;
    }

    pollRef.current = setInterval(() => {
      fetchJson<GenerationStatus>(
        apiUrl(`/api/onboarding/generate-projects?workspace_id=${workspaceId}`),
      )
        .then((data) => setStatus(data))
        .catch(() => {
          /* Ignore poll errors */
        });
    }, 3000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [workspaceId, dismissed, status?.status]);

  // Progress through status messages
  useEffect(() => {
    if (status?.status === 'complete' || status?.status === 'error') return;
    if (!status?.pending && status?.status !== 'pending') return;

    const advanceMessage = () => {
      setMessageIndex((prev) => {
        const next = prev + 1;
        if (next < STATUS_MESSAGES.length) {
          messageTimerRef.current = setTimeout(advanceMessage, STATUS_MESSAGES[next]!.durationMs);
          return next;
        }
        return prev; // Stay on last message
      });
    };

    messageTimerRef.current = setTimeout(advanceMessage, STATUS_MESSAGES[0]!.durationMs);

    return () => {
      if (messageTimerRef.current) {
        clearTimeout(messageTimerRef.current);
        messageTimerRef.current = null;
      }
    };
  }, [status?.pending, status?.status]);

  const handleDismiss = useCallback(() => {
    if (!workspaceId) return;
    setDismissed(true);
    localStorage.setItem(`onboarding_generation_dismissed_${workspaceId}`, 'true');
    localStorage.removeItem(`onboarding_generation_pending_${workspaceId}`);
  }, [workspaceId]);

  // Don't render if dismissed, or if generation hasn't been triggered
  if (dismissed) return null;
  if (!status) return null;
  if (status.status === 'none' && !status.pending) return null;

  const isComplete = status.status === 'complete';
  const isError = status.status === 'error';
  const currentMessage = isComplete
    ? 'Your workspace is ready!'
    : isError
      ? 'Something went wrong during setup.'
      : (STATUS_MESSAGES[messageIndex]?.text ?? 'Setting up your workspace...');

  return (
    <div className="border-border bg-surface-75 mb-6 overflow-hidden rounded-lg border">
      <div className="p-6">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              isComplete ? 'bg-brand/10' : isError ? 'bg-red-500/10' : 'bg-brand/10'
            }`}
          >
            {isComplete ? (
              <CheckCircle2 className="text-brand h-5 w-5" />
            ) : isError ? (
              <Sparkles className="h-5 w-5 text-red-400" />
            ) : (
              <Loader2 className="text-brand h-5 w-5 animate-spin" />
            )}
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <h3 className="text-foreground text-sm font-medium">
              {isComplete
                ? 'Projects generated'
                : isError
                  ? 'Generation failed'
                  : 'Setting up your workspace'}
            </h3>
            <p
              className={`mt-1 text-sm transition-opacity duration-500 ${
                isError ? 'text-red-400' : 'text-muted-foreground'
              }`}
            >
              {currentMessage}
            </p>

            {/* Progress bar (only during loading) */}
            {!isComplete && !isError && (
              <div className="bg-surface-200 mt-3 h-1 overflow-hidden rounded-full">
                <div
                  className="bg-brand h-full rounded-full transition-all duration-1000 ease-out"
                  style={{
                    width: `${Math.min(((messageIndex + 1) / (STATUS_MESSAGES.length + 1)) * 100, 90)}%`,
                  }}
                />
              </div>
            )}

            {/* CTA on completion */}
            {isComplete && (
              <div className="mt-4 flex items-center gap-3">
                <Button asChild size="sm" className="gap-1.5 text-black">
                  <Link href={workspaceHref('/projects')} onClick={handleDismiss}>
                    View your projects
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="text-muted-foreground hover:text-foreground text-xs transition-colors"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Dismiss on error */}
            {isError && (
              <button
                type="button"
                onClick={handleDismiss}
                className="text-muted-foreground hover:text-foreground mt-3 text-xs transition-colors"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
