'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Circle,
  ArrowRight,
  X,
  Bot,
  FolderKanban,
  KanbanSquare,
  Github,
  Building2,
  Key,
} from 'lucide-react';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import type { SetupStatusResponse } from '@/app/api/workspace/setup-status/route';

const STEP_ICONS: Record<string, typeof Bot> = {
  workspace: Building2,
  api_keys: Key,
  agents: Bot,
  project: FolderKanban,
  task: KanbanSquare,
  github: Github,
};

export function OnboardingChecklist() {
  const { activeWorkspace } = useWorkspace();
  const { workspaceHref } = useWorkspaceHref();
  const [data, setData] = useState<SetupStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    try {
      const result = await fetchJson<SetupStatusResponse>(
        apiUrl(`/api/workspace/setup-status?workspace_id=${activeWorkspace.id}`),
      );
      setData(result);
    } catch {
      // Silently fail — checklist is non-critical
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Check localStorage for dismissal
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    const key = `onboarding-dismissed-${activeWorkspace.id}`;
    try {
      if (localStorage.getItem(key) === 'true') {
        setDismissed(true);
      }
    } catch {
      // localStorage unavailable (private browsing)
    }
  }, [activeWorkspace?.id]);

  if (dismissed) return null;

  if (loading || !data) {
    return (
      <div className="border-border bg-surface-75 rounded-lg border p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="bg-surface-200 mb-1 h-4 w-24 animate-pulse rounded" />
            <div className="bg-surface-200 h-3 w-16 animate-pulse rounded" />
          </div>
        </div>
        <div className="bg-surface-200 mb-3 h-1.5 animate-pulse rounded-full" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2">
              <div className="bg-surface-200 h-5 w-5 animate-pulse rounded-full" />
              <div className="bg-surface-200 h-4 flex-1 animate-pulse rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Don't show if all steps are complete
  if (data.completed_count === data.total_count) return null;

  const progressPct = Math.round((data.completed_count / data.total_count) * 100);

  function handleDismiss() {
    if (!activeWorkspace?.id) return;
    try {
      localStorage.setItem(`onboarding-dismissed-${activeWorkspace.id}`, 'true');
    } catch {
      // localStorage unavailable
    }
    setDismissed(true);
  }

  return (
    <div className="border-border bg-surface-75 rounded-lg border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div>
          <h3 className="text-foreground text-sm font-semibold">Get started</h3>
          <p className="text-muted-foreground text-xs">
            {data.completed_count}/{data.total_count} steps complete
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground cursor-pointer p-1 transition-colors"
          aria-label="Dismiss onboarding checklist"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="bg-surface-200 mx-4 mb-3 h-1.5 overflow-hidden rounded-full">
        <div
          className="bg-brand h-full rounded-full transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Steps */}
      <div className="space-y-0.5 px-2 pb-2">
        {data.steps.map((step) => {
          const Icon = STEP_ICONS[step.id] ?? Circle;
          return (
            <Link
              key={step.id}
              href={workspaceHref(step.action_url)}
              className={`hover:bg-surface-100 flex items-center gap-3 rounded-md px-2 py-2 transition-colors ${
                step.completed ? 'opacity-60' : ''
              }`}
            >
              {step.completed ? (
                <CheckCircle2 className="text-brand h-5 w-5 shrink-0" />
              ) : (
                <Icon className="text-muted-foreground h-5 w-5 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-medium ${step.completed ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                >
                  {step.title}
                </p>
                {!step.completed && (
                  <p className="text-muted-foreground truncate text-xs">{step.description}</p>
                )}
              </div>
              {!step.completed && <ArrowRight className="text-muted-foreground h-4 w-4 shrink-0" />}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
