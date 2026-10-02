import type { HarnessEffect, HarnessRunEvent } from './types.ts';

export interface RunEventMappingOptions {
  /** Where a succeeded run lands. Review by default so a person checks agent work. */
  completeTo?: 'review' | 'done';
}

/**
 * The default inbound mapping. Adapters return this from onRunEvent unless the
 * host needs different behavior, and the service uses it when no adapter is registered.
 */
export function defaultRunEventMapping(
  event: HarnessRunEvent,
  options: RunEventMappingOptions = {},
): HarnessEffect {
  switch (event.status) {
    case 'queued':
      return { heartbeat: true };
    case 'waiting':
      return { heartbeat: true, actionState: 'open_question' };
    case 'running':
      // Only blocks the harness itself set are lifted; the service checks blocked_by.
      return { status: 'in_progress', heartbeat: true, unblock: true, actionState: null };
    case 'succeeded':
      return {
        status: options.completeTo ?? 'review',
        outcome: event.outcome ?? null,
        actionState: null,
      };
    case 'failed':
      return {
        block: `Run failed: ${event.error?.trim() || 'no detail from the harness'}`,
        actionState: 'run_failed',
      };
    case 'timed_out':
      return { block: 'Run timed out', actionState: 'run_failed' };
    case 'budget_exceeded':
      return { block: 'Run stopped: budget exceeded', actionState: 'run_failed' };
    case 'cancelled':
      return { status: 'planning', release: true, actionState: null };
  }
}
