'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  RefreshCw,
  X,
  Key,
  UserPlus,
  Rocket,
  CreditCard,
  GitBranch,
  UserCheck,
} from 'lucide-react';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import type {
  GettingStartedResponse,
  GettingStartedStep,
  StepGroup,
} from '@/app/api/workspace/getting-started/route';

// ─── Readiness Alerts ───────────────────────────────────────────────────────

interface GateResult {
  status: 'pass' | 'fail';
  detail: string;
}

interface ReadinessResponse {
  gates: Record<string, GateResult>;
  ready: boolean;
}

const GATE_META: Record<string, { label: string; icon: typeof AlertTriangle; href: string }> = {
  api_keys: { label: 'API keys not configured', icon: Key, href: '/settings?tab=integrations' },
  onboarding: { label: 'Workspace setup incomplete', icon: Rocket, href: '/settings' },
  plan: { label: 'No active plan', icon: CreditCard, href: '/settings?tab=billing' },
  workspace: {
    label: 'Repository not connected',
    icon: GitBranch,
    href: '/settings?tab=integrations',
  },
  account: { label: 'Account not verified', icon: UserCheck, href: '/settings?tab=members' },
};

// ─── Constants ──────────────────────────────────────────────────────────────

/** Steps that show a loading animation while generation is in progress */
const GENERATING_STEPS = new Set(['reviewed_memories', 'reviewed_projects', 'reviewed_team']);

/** Steps that are completed by clicking (visiting the page), not by data existing */
const VISIT_STEPS = new Set(['reviewed_projects', 'reviewed_team', 'reviewed_memories']);

interface GroupConfig {
  key: StepGroup;
  title: string;
  icon: typeof Rocket;
  step: number;
}

const GROUPS: GroupConfig[] = [
  { key: 'explore', title: 'Get to know your workspace', icon: Rocket, step: 1 },
  { key: 'connect', title: 'Connect your tools', icon: Key, step: 2 },
  { key: 'grow', title: 'Grow your workspace', icon: UserPlus, step: 3 },
];

// ─── Skeleton ───────────────────────────────────────────────────────────────

function GettingStartedSkeleton() {
  return (
    <div className="border-border bg-surface-75 rounded-lg border">
      <div className="flex items-center justify-between px-5 pt-5 pb-4">
        <div>
          <div className="bg-surface-200 mb-1.5 h-5 w-36 animate-pulse rounded" />
          <div className="bg-surface-200 h-3.5 w-24 animate-pulse rounded" />
        </div>
      </div>
      <div className="space-y-1 px-3 pb-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-surface-100 rounded-md px-3 py-3">
            <div className="flex items-center gap-3">
              <div className="bg-surface-200 h-4 w-4 animate-pulse rounded" />
              <div className="bg-surface-200 h-4 flex-1 animate-pulse rounded" />
              <div className="bg-surface-200 h-4 w-10 animate-pulse rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Step Row ───────────────────────────────────────────────────────────────

// ─── Bouncing Dots ─────────────────────────────────────────────────────────

function BouncingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="bg-brand h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:0ms]" />
      <span className="bg-brand h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:150ms]" />
      <span className="bg-brand h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:300ms]" />
    </span>
  );
}

// ─── Step Row ───────────────────────────────────────────────────────────────

interface StepRowProps {
  step: GettingStartedStep;
  href: string;
  generating: boolean;
  onVisit?: (stepKey: string) => void;
}

function StepRow({ step, href, generating, onVisit }: StepRowProps) {
  const isGenerating = generating && GENERATING_STEPS.has(step.key) && !step.completed;
  const isVisitStep = VISIT_STEPS.has(step.key);

  // When generating, render as a non-clickable row with loading animation
  if (isGenerating) {
    return (
      <div className="flex items-start gap-3 rounded-md px-3 py-2.5">
        <CheckCircle2 className="text-muted-foreground/30 mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-foreground text-[15px] leading-snug font-medium">
              {step.key === 'reviewed_memories'
                ? 'Saving memories'
                : step.key === 'reviewed_projects'
                  ? 'Generating projects'
                  : 'Generating agents'}
            </p>
            <BouncingDots />
          </div>
          <p className="text-muted-foreground mt-0.5 text-[14px] leading-snug">
            This can take a few minutes — feel free to explore while you wait.
          </p>
        </div>
      </div>
    );
  }

  function handleClick() {
    if (isVisitStep && !step.completed && onVisit) {
      onVisit(step.key);
    }
  }

  return (
    <Link
      href={href}
      onClick={handleClick}
      className="hover:bg-surface-100 group flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors"
    >
      <CheckCircle2
        className={`mt-0.5 h-4 w-4 shrink-0 transition-colors ${
          step.completed ? 'text-brand' : 'text-muted-foreground/30'
        }`}
      />
      <div className={`min-w-0 flex-1 ${step.completed ? 'opacity-40' : ''}`}>
        <p className="text-foreground text-[15px] leading-snug font-medium">{step.title}</p>
        <p className="text-muted-foreground mt-0.5 text-[14px] leading-snug">{step.description}</p>
      </div>
      {!step.completed && (
        <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0 -rotate-90 self-center opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </Link>
  );
}

// ─── Section Group ──────────────────────────────────────────────────────────

interface SectionGroupProps {
  config: GroupConfig;
  steps: GettingStartedStep[];
  expanded: boolean;
  onToggle: () => void;
  generating: boolean;
  onVisit?: (stepKey: string) => void;
}

function SectionGroup({
  config,
  steps,
  expanded,
  onToggle,
  generating,
  onVisit,
}: SectionGroupProps) {
  const { workspaceHref } = useWorkspaceHref();
  const completedCount = steps.filter((s) => s.completed).length;
  const totalCount = steps.length;
  const allDone = completedCount === totalCount;

  if (totalCount === 0) return null;

  return (
    <div
      className={`border-border/50 overflow-hidden rounded-md border transition-[margin] duration-200 ${
        expanded ? 'mb-4' : ''
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="hover:bg-surface-100 flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors"
      >
        {allDone ? (
          <CheckCircle2 className="text-brand h-6 w-6 shrink-0" />
        ) : (
          <span className="border-border bg-surface-200 text-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold">
            {config.step}
          </span>
        )}
        <span className="text-foreground flex-1 text-left text-[13px] font-semibold">
          Step {config.step}: {config.title}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {completedCount}/{totalCount}
        </span>
        <ChevronDown
          className={`text-muted-foreground h-4 w-4 shrink-0 transition-transform duration-200 ${
            expanded ? '' : '-rotate-90'
          }`}
        />
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          {/* Indent tasks to align with "Step N:" text (past the circle badge + gap) */}
          <div className="border-border/50 border-t py-1 pr-1 pl-[44px]">
            {steps.map((step) => (
              <StepRow
                key={step.key}
                step={step}
                href={workspaceHref(step.href)}
                generating={generating}
                onVisit={onVisit}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function GettingStartedGuide() {
  const { activeWorkspace } = useWorkspace();
  const { workspaceHref } = useWorkspaceHref();
  const [data, setData] = useState<GettingStartedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<StepGroup, boolean>>({
    explore: true,
    connect: false,
    grow: false,
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const dismissKey = activeWorkspace?.id ? `getting-started-dismissed-${activeWorkspace.id}` : null;

  // Check localStorage for dismissal and generation pending flag
  useEffect(() => {
    if (!dismissKey) return;
    try {
      if (localStorage.getItem(dismissKey) === 'true') {
        setDismissed(true);
      }
    } catch {
      // localStorage unavailable
    }
    // Check if generation is pending (set during onboarding)
    if (activeWorkspace?.id) {
      try {
        const pending =
          localStorage.getItem(`onboarding_generation_pending_${activeWorkspace.id}`) === 'true';
        if (pending) setGenerating(true);
      } catch {
        // localStorage unavailable
      }
    }
  }, [dismissKey, activeWorkspace?.id]);

  const fetchStatus = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    try {
      const result = await fetchJson<GettingStartedResponse>(
        apiUrl(`/api/workspace/getting-started?workspace_id=${activeWorkspace.id}`),
      );

      setData(result);

      // Sync generation state from API
      if (result.generating) {
        setGenerating(true);
        setGenerationError(false);
      } else if (generating) {
        // Generation just finished — clear localStorage flags
        setGenerating(false);
        if (activeWorkspace?.id) {
          try {
            localStorage.removeItem(`onboarding_generation_pending_${activeWorkspace.id}`);
            localStorage.removeItem(`onboarding_generation_error_${activeWorkspace.id}`);
          } catch {
            // localStorage unavailable
          }
        }
      }

      // Check for error state from API or localStorage
      if (result.generation_error) {
        setGenerationError(true);
        setGenerating(false);
      } else if (activeWorkspace?.id) {
        try {
          const hasLocalError =
            localStorage.getItem(`onboarding_generation_error_${activeWorkspace.id}`) === 'true';
          if (hasLocalError && !result.generating) {
            setGenerationError(true);
            setGenerating(false);
          }
        } catch {
          // localStorage unavailable
        }
      }

      // Auto-collapse groups where all steps are done
      const grouped: Partial<Record<StepGroup, GettingStartedStep[]>> = {};
      for (const step of result.steps) {
        if (step.conditional && !step.available) continue;
        if (!grouped[step.group]) grouped[step.group] = [];
        grouped[step.group]!.push(step);
      }

      setExpandedGroups((prev) => {
        const next = { ...prev };
        for (const g of GROUPS) {
          const steps = grouped[g.key];
          if (steps && steps.every((s) => s.completed)) {
            next[g.key] = false;
          }
        }
        // Ensure at least one incomplete group is expanded
        const hasExpanded = GROUPS.some((g) => next[g.key]);
        if (!hasExpanded) {
          const firstIncomplete = GROUPS.find((g) => {
            const steps = grouped[g.key];
            return steps && steps.some((s) => !s.completed);
          });
          if (firstIncomplete) next[firstIncomplete.key] = true;
        }
        return next;
      });
    } catch {
      // Silently fail — guide is non-critical
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace?.id, data, generating]);

  // Initial fetch
  useEffect(() => {
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace?.id]);

  // Poll every 5s while generation is in progress
  useEffect(() => {
    if (!generating || !activeWorkspace?.id) return;
    pollRef.current = setInterval(() => {
      fetchStatus();
    }, 5000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [generating, activeWorkspace?.id, fetchStatus]);

  // Re-fetch on visibility change (tab regain focus)
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        fetchStatus();
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [fetchStatus]);

  // Helper: read locally visited steps from localStorage
  const localVisitKey = activeWorkspace?.id
    ? `getting-started-visited-${activeWorkspace.id}`
    : null;

  function getLocalVisits(): Set<string> {
    if (!localVisitKey) return new Set();
    try {
      const raw = localStorage.getItem(localVisitKey);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  }

  // Group steps by their group key, filtering unavailable conditional steps
  // Merge localStorage visits so visit-based steps show as completed immediately
  const groupedSteps = useMemo(() => {
    if (!data) return {};
    const localVisits = getLocalVisits();
    const grouped: Partial<Record<StepGroup, GettingStartedStep[]>> = {};
    for (const step of data.steps) {
      if (step.conditional && !step.available) continue;
      const merged =
        VISIT_STEPS.has(step.key) && localVisits.has(step.key)
          ? { ...step, completed: true }
          : step;
      if (!grouped[merged.group]) grouped[merged.group] = [];
      grouped[merged.group]!.push(merged);
    }
    return grouped;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Compute merged completed/total counts (includes localStorage visits)
  const mergedCompletedCount = useMemo(() => {
    let count = 0;
    for (const steps of Object.values(groupedSteps)) {
      if (steps) count += steps.filter((s) => s.completed).length;
    }
    return count;
  }, [groupedSteps]);

  const mergedTotalCount = useMemo(() => {
    let count = 0;
    for (const steps of Object.values(groupedSteps)) {
      if (steps) count += steps.length;
    }
    return count;
  }, [groupedSteps]);

  function handleDismiss() {
    if (!dismissKey) return;
    try {
      localStorage.setItem(dismissKey, 'true');
    } catch {
      // localStorage unavailable
    }
    setDismissed(true);
  }

  function handleRestore() {
    if (!dismissKey) return;
    try {
      localStorage.removeItem(dismissKey);
    } catch {
      // localStorage unavailable
    }
    setDismissed(false);
  }

  function toggleGroup(group: StepGroup) {
    setExpandedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  }

  // Record that the user clicked/visited a review step
  const handleStepVisit = useCallback(
    (stepKey: string) => {
      if (!activeWorkspace?.id || !localVisitKey) return;
      // Persist in localStorage synchronously so it survives navigation
      try {
        const visits = getLocalVisits();
        visits.add(stepKey);
        localStorage.setItem(localVisitKey, JSON.stringify([...visits]));
      } catch {
        // localStorage unavailable
      }
      // Fire-and-forget API call to persist server-side (may be cancelled by navigation)
      fetch(apiUrl('/api/workspace/getting-started'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: activeWorkspace.id, step_key: stepKey }),
        keepalive: true, // survive page navigation
      }).catch(() => {});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeWorkspace?.id, localVisitKey],
  );

  async function handleRetryGeneration() {
    if (!activeWorkspace?.id || retrying) return;
    setRetrying(true);
    setGenerationError(false);
    try {
      localStorage.removeItem(`onboarding_generation_error_${activeWorkspace.id}`);
      localStorage.setItem(`onboarding_generation_pending_${activeWorkspace.id}`, 'true');
    } catch {
      /* localStorage unavailable */
    }
    setGenerating(true);
    try {
      const res = await fetch(apiUrl('/api/onboarding/generate-projects'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: activeWorkspace.id }),
      });
      if (!res.ok) {
        setGenerationError(true);
        setGenerating(false);
      }
    } catch {
      setGenerationError(true);
      setGenerating(false);
    } finally {
      setRetrying(false);
    }
  }

  // Dismissed state: show minimal restore link
  if (dismissed) {
    return (
      <button
        type="button"
        onClick={handleRestore}
        className="text-muted-foreground hover:text-foreground cursor-pointer text-xs transition-colors"
      >
        Show getting started guide
      </button>
    );
  }

  if (loading || !data) {
    return <GettingStartedSkeleton />;
  }

  // Don't show if all steps are complete
  if (mergedCompletedCount === mergedTotalCount) return null;

  // Can only dismiss after completing the first group ("Get to know your workspace")
  const exploreSteps = groupedSteps['explore'] ?? [];
  const canDismiss = exploreSteps.length > 0 && exploreSteps.every((s) => s.completed);

  return (
    <div className="border-border bg-surface-75 rounded-lg border">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4">
        <div>
          <h3 className="text-foreground text-sm font-semibold">Getting Started</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {mergedCompletedCount} of {mergedTotalCount} complete
          </p>
        </div>
        <div className="group relative">
          <button
            type="button"
            onClick={canDismiss ? handleDismiss : undefined}
            className={`rounded-md p-1 transition-colors ${
              canDismiss
                ? 'text-muted-foreground hover:text-foreground cursor-pointer'
                : 'cursor-not-allowed text-white/10'
            }`}
            aria-label="Dismiss getting started guide"
            disabled={!canDismiss}
          >
            <X className="h-4 w-4" />
          </button>
          {!canDismiss && (
            <div className="bg-surface-300 text-foreground-lighter pointer-events-none absolute top-full right-0 z-20 mt-1 rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
              Complete &ldquo;Get to know your workspace&rdquo; to dismiss
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-surface-200 mx-5 mb-4 h-1.5 overflow-hidden rounded-full">
        <div
          className="bg-brand h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.round((mergedCompletedCount / mergedTotalCount) * 100)}%` }}
        />
      </div>

      {/* Generation error banner with retry */}
      {generationError && (
        <div className="border-warning-foreground/25 bg-warning-foreground/8 mx-3 mb-2 flex items-center gap-2.5 rounded-md border px-3 py-2.5">
          <AlertTriangle className="text-warning-foreground h-3.5 w-3.5 shrink-0" />
          <span className="text-foreground flex-1 text-[13px]">
            Your workspace seeding hit a snag — reach out to support.
          </span>
          <div className="flex items-center gap-2.5">
            <Link
              href={workspaceHref('/support/contact')}
              className="text-muted-foreground hover:text-foreground text-xs font-medium transition-colors"
            >
              File a ticket
            </Link>
            <button
              type="button"
              onClick={handleRetryGeneration}
              disabled={retrying}
              className="text-brand hover:text-brand/80 flex cursor-pointer items-center gap-1 text-xs font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${retrying ? 'animate-spin' : ''}`} />
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Step groups */}
      <div className="space-y-1.5 px-3 pb-3">
        {GROUPS.map((group) => {
          const steps = groupedSteps[group.key];
          if (!steps || steps.length === 0) return null;
          return (
            <SectionGroup
              key={group.key}
              config={group}
              steps={steps}
              expanded={expandedGroups[group.key]}
              onToggle={() => toggleGroup(group.key)}
              generating={generating}
              onVisit={handleStepVisit}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Readiness Alerts (standalone) ──────────────────────────────────────────

export function ReadinessAlerts() {
  const { activeWorkspace } = useWorkspace();
  const { workspaceHref } = useWorkspaceHref();
  const [failingGates, setFailingGates] = useState<Array<[string, GateResult]>>([]);

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    fetchJson<ReadinessResponse>(apiUrl(`/api/readiness?workspace_id=${activeWorkspace.id}`))
      .then((res) => {
        const failing = Object.entries(res.gates).filter(([, g]) => g.status === 'fail');
        setFailingGates(failing);
      })
      .catch(() => {});
  }, [activeWorkspace?.id]);

  if (failingGates.length === 0) return null;

  return (
    <div className="mb-6 space-y-3">
      {failingGates.map(([key]) => {
        const gate = GATE_META[key];
        if (!gate) return null;
        return (
          <Link
            key={key}
            href={workspaceHref(gate.href)}
            className="border-warning-foreground/25 bg-warning-foreground/8 hover:bg-warning-foreground/15 flex items-center gap-2.5 rounded-md border px-3 py-2.5 transition-colors"
          >
            <AlertTriangle className="text-warning-foreground h-3.5 w-3.5 shrink-0" />
            <span className="text-foreground text-[13px] font-medium">{gate.label}</span>
            <ChevronDown className="text-muted-foreground ml-auto h-3.5 w-3.5 shrink-0 -rotate-90" />
          </Link>
        );
      })}
    </div>
  );
}
