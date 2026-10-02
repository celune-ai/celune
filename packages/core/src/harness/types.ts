import type { ActorContext } from '../actor.ts';
import type { WorkspaceScope } from '../scope.ts';
import type { TaskLifecycleStatus } from '../store.ts';

/** Run states a harness reports. The five terminal states end a run. */
export const HARNESS_RUN_STATUSES = [
  'queued',
  'running',
  'waiting',
  'succeeded',
  'failed',
  'cancelled',
  'budget_exceeded',
  'timed_out',
] as const;

export type HarnessRunStatus = (typeof HARNESS_RUN_STATUSES)[number];

export const TERMINAL_RUN_STATUSES: ReadonlySet<HarnessRunStatus> = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'budget_exceeded',
  'timed_out',
]);

/** The run states that have not ended. */
export const ACTIVE_RUN_STATUSES: readonly HarnessRunStatus[] = HARNESS_RUN_STATUSES.filter(
  (status) => !TERMINAL_RUN_STATUSES.has(status),
);

export function isHarnessRunStatus(value: unknown): value is HarnessRunStatus {
  return typeof value === 'string' && (HARNESS_RUN_STATUSES as readonly string[]).includes(value);
}

export function isTerminalRunStatus(status: HarnessRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

/** What a harness can do. The service skips calls a harness does not support. */
export interface HarnessCapabilities {
  /** Stable harness name, stored on the task as harness_run.harness. */
  name: string;
  version: string;
  /** cancelRun stops a live run. */
  cancel: boolean;
  /** heartbeat returns the current run state on demand. */
  heartbeat: boolean;
  /** The harness enforces a spend budget and can report budget_exceeded. */
  budgets: boolean;
}

/** Identifies one run inside one harness. */
export interface HarnessRunRef {
  harness: string;
  runId: string;
}

/** The task fields a harness receives. Hosts never see Celune internals beyond this. */
export interface HarnessTaskInput {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  projectId: string | null;
  workspaceId: string;
  orgId: string | null;
}

export interface HarnessRunContext {
  scope: WorkspaceScope;
  /** Celune agent id that claimed the task. */
  agentId: string;
  /** Agent id inside the harness, from the registry's agent map. */
  harnessAgentId: string;
  actor: ActorContext;
}

export interface StartRunResult {
  runId: string;
  status?: HarnessRunStatus;
  /** Link to the run in the host UI, when the host has one. */
  url?: string | null;
  /**
   * Host principal the run was started as, when it is not the adapter's default.
   * Stored on the task so an adapter can pick the same credentials after a restart.
   */
  runAs?: string | null;
}

/** Inbound report of a run state change. `id` is the idempotency key. */
export interface HarnessRunEvent {
  id: string;
  taskId: string;
  runRef: HarnessRunRef;
  status: HarnessRunStatus;
  /** ISO timestamp from the harness. Older events than the last applied one are stale. */
  occurredAt: string;
  outcome?: string | null;
  error?: string | null;
  progress?: Record<string, unknown>;
}

/**
 * What an inbound event does to the task. Every status change still passes
 * through TaskService and its transition validator.
 */
export interface HarnessEffect {
  status?: TaskLifecycleStatus;
  outcome?: string | null;
  block?: string;
  unblock?: boolean;
  /** Ends the agent's active session on the task. */
  release?: boolean;
  /** Records an agent heartbeat row. */
  heartbeat?: boolean;
  /**
   * Written to metadata.action_state so a board can flag tasks that need a
   * person (`run_failed`, `open_question`). Null clears it; undefined leaves it.
   */
  actionState?: string | null;
}

export interface HarnessHeartbeat {
  status: HarnessRunStatus;
  at: string;
  progress?: Record<string, unknown>;
}

/** The contract a host implements to run Celune tasks on its own agent runtime. */
export interface HarnessAdapter {
  capabilities(): HarnessCapabilities;
  /** Outbound: start a run for a claimed task. */
  startRun(task: HarnessTaskInput, context: HarnessRunContext): Promise<StartRunResult>;
  /** Inbound: map a run event to its effect on the task. Pure; no I/O. */
  onRunEvent(event: HarnessRunEvent): HarnessEffect;
  /** Pull the current run state. Only called when capabilities().heartbeat is true. */
  heartbeat(runRef: HarnessRunRef): Promise<HarnessHeartbeat>;
  /** Stop a run. Only called when capabilities().cancel is true. */
  cancelRun(runRef: HarnessRunRef): Promise<void>;
}

/** Run record kept on the task at metadata.harness_run. */
export interface HarnessRunRecord {
  harness: string;
  run_id: string;
  harness_agent: string | null;
  status: HarnessRunStatus;
  started_at: string;
  url?: string | null;
  /** Host principal the run was started as (StartRunResult.runAs). */
  run_as?: string | null;
  last_event_id?: string;
  last_event_at?: string;
  ended_at?: string;
  /** Most recent applied event ids, for idempotency across restarts. */
  event_ids: string[];
}
