'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { isPlanLimitError, type PlanLimitPayload } from '@/lib/plan-limit-error';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { PLAN_LABELS } from '@repo/types';
import type { Plan } from '@repo/types';

/** Human-readable labels for limit keys returned by plan enforcement. */
const LIMIT_LABELS: Record<string, string> = {
  max_tasks_per_month: 'tasks this month',
  max_agents: 'agents',
  max_memories: 'memory entries',
  max_tts_minutes_per_month: 'TTS minutes this month',
  max_api_calls_per_month: 'API calls this month',
  max_llm_cost_per_month: 'LLM usage this month',
};

function formatLimitMessage(payload: PlanLimitPayload): string {
  const label = LIMIT_LABELS[payload.limit] ?? payload.limit;
  const planLabel = PLAN_LABELS[payload.plan as Plan] ?? payload.plan;
  return `You've reached your ${label} limit (${payload.current}/${payload.max}) on the ${planLabel} plan.`;
}

/**
 * Hook that provides helpers for handling plan limit errors in the UI.
 *
 * `handlePlanLimitError(err)` — checks if `err` is a PlanLimitError,
 * shows a toast with the limit info and an upgrade link, and returns true.
 * Returns false if the error is not a plan limit error.
 *
 * Usage:
 * ```ts
 * const { handlePlanLimitError } = usePlanLimitToast();
 *
 * try {
 *   await fetchJson('/api/tasks', { method: 'POST', body });
 * } catch (err) {
 *   if (!handlePlanLimitError(err)) {
 *     toast.error('Something went wrong');
 *   }
 * }
 * ```
 */
export function usePlanLimitToast() {
  const { workspaceHref } = useWorkspaceHref();
  const billingUrl = workspaceHref('/settings?tab=billing');

  const handlePlanLimitError = useCallback(
    (err: unknown): boolean => {
      if (!isPlanLimitError(err)) return false;

      const message = formatLimitMessage(err.payload);

      toast.error(message, {
        duration: 8000,
        action: {
          label: 'Upgrade',
          onClick: () => {
            window.location.href = billingUrl;
          },
        },
      });

      return true;
    },
    [billingUrl],
  );

  return { handlePlanLimitError };
}
