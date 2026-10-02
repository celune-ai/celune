import type { HarnessRunStatus } from '@celuneai/core';

/** AgentRun.status values in the Headways schema. `timeout` is what the worker reports before it is stored as `failed`. */
export const AGENT_RUN_STATUSES = [
  'queued',
  'running',
  'awaiting_input',
  'completed',
  'cancelled',
  'failed',
  'budget_exceeded',
] as const;

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

const TO_RUN_STATUS: Record<string, HarnessRunStatus> = {
  queued: 'queued',
  running: 'running',
  awaiting_input: 'waiting',
  completed: 'succeeded',
  cancelled: 'cancelled',
  failed: 'failed',
  budget_exceeded: 'budget_exceeded',
  timeout: 'timed_out',
};

/** Maps an AgentRun status onto the harness contract. Unknown values read as queued so nothing moves. */
export function toHarnessRunStatus(status: string): HarnessRunStatus {
  return TO_RUN_STATUS[status] ?? 'queued';
}

/**
 * The Headways control-plane transition that produces each status. Event ids
 * are `<run_id>:<transition>`, so a retry of the same transition dedupes in Celune.
 */
const TRANSITION: Record<HarnessRunStatus, string> = {
  queued: 'queue',
  running: 'dispatch',
  waiting: 'park-awaiting',
  succeeded: 'finalize',
  budget_exceeded: 'finalize',
  timed_out: 'finalize',
  failed: 'fail',
  cancelled: 'cancel',
};

/**
 * Stable event id for one transition of one run. Cancels use `cancel:<run_id>`,
 * the id HarnessService.cancel writes, so a cancel that starts in Celune is applied once.
 * `occurrence` counts repeats of a transition (a run that parks twice dispatches twice).
 */
export function eventIdFor(runId: string, status: HarnessRunStatus, occurrence = 1): string {
  if (status === 'cancelled') return `cancel:${runId}`;
  const base = `${runId}:${TRANSITION[status]}`;
  return occurrence > 1 ? `${base}:${occurrence}` : base;
}

/**
 * Highest occurrence per status already applied for one run, read from the
 * event ids Celune keeps on the task. Lets a restarted watcher continue the
 * `:<n>` counters instead of reusing an id Celune has already taken.
 */
export function occurrencesFromEventIds(
  runId: string,
  eventIds: readonly string[],
): Map<HarnessRunStatus, number> {
  const byTransition = new Map<string, number>();
  const prefix = `${runId}:`;
  for (const id of eventIds) {
    if (!id.startsWith(prefix)) continue;
    const [transition, count] = id.slice(prefix.length).split(':');
    if (!transition) continue;
    const n = count === undefined ? 1 : Number(count);
    if (!Number.isInteger(n) || n < 1) continue;
    byTransition.set(transition, Math.max(byTransition.get(transition) ?? 0, n));
  }
  const occurrences = new Map<HarnessRunStatus, number>();
  for (const [status, transition] of Object.entries(TRANSITION) as Array<
    [HarnessRunStatus, string]
  >) {
    const n = byTransition.get(transition);
    if (n) occurrences.set(status, n);
  }
  return occurrences;
}
