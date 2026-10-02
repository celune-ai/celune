import { NotFound } from '../errors.ts';
import { defaultRunEventMapping, type RunEventMappingOptions } from './mapping.ts';
import type {
  HarnessAdapter,
  HarnessCapabilities,
  HarnessEffect,
  HarnessHeartbeat,
  HarnessRunContext,
  HarnessRunEvent,
  HarnessRunRef,
  HarnessRunStatus,
  HarnessTaskInput,
  StartRunResult,
} from './types.ts';

export interface LoopbackRun {
  runId: string;
  task: HarnessTaskInput;
  context: HarnessRunContext;
  status: HarnessRunStatus;
}

export interface LoopbackHarnessOptions {
  name?: string;
  clock?: () => Date;
  /** Makes startRun reject with this message, to exercise the failure path. */
  failStart?: string;
  capabilities?: Partial<Omit<HarnessCapabilities, 'name'>>;
  mapping?: RunEventMappingOptions;
}

/**
 * In-process harness for tests and local development. Runs never execute;
 * callers drive them by building events with `event()`.
 */
export class LoopbackHarness implements HarnessAdapter {
  readonly runs = new Map<string, LoopbackRun>();
  readonly cancelled: string[] = [];
  private readonly name: string;
  private readonly clock: () => Date;
  private readonly options: LoopbackHarnessOptions;
  private runCounter = 0;
  private eventCounter = 0;

  constructor(options: LoopbackHarnessOptions = {}) {
    this.options = options;
    this.name = options.name ?? 'loopback';
    this.clock = options.clock ?? (() => new Date());
  }

  capabilities(): HarnessCapabilities {
    return {
      name: this.name,
      version: '1.0.0',
      cancel: true,
      heartbeat: true,
      budgets: true,
      ...this.options.capabilities,
    };
  }

  async startRun(task: HarnessTaskInput, context: HarnessRunContext): Promise<StartRunResult> {
    if (this.options.failStart) throw new Error(this.options.failStart);
    this.runCounter += 1;
    const runId = `${this.name}-run-${this.runCounter}`;
    this.runs.set(runId, { runId, task, context, status: 'queued' });
    return { runId, status: 'queued' };
  }

  onRunEvent(event: HarnessRunEvent): HarnessEffect {
    return defaultRunEventMapping(event, this.options.mapping);
  }

  async heartbeat(runRef: HarnessRunRef): Promise<HarnessHeartbeat> {
    const run = this.require(runRef.runId);
    return { status: run.status, at: this.clock().toISOString() };
  }

  async cancelRun(runRef: HarnessRunRef): Promise<void> {
    const run = this.require(runRef.runId);
    run.status = 'cancelled';
    this.cancelled.push(runRef.runId);
  }

  /** Moves a run to a new status and returns the event a host would send. */
  event(
    runId: string,
    status: HarnessRunStatus,
    extra: Partial<
      Pick<HarnessRunEvent, 'outcome' | 'error' | 'progress' | 'occurredAt' | 'id'>
    > = {},
  ): HarnessRunEvent {
    const run = this.require(runId);
    run.status = status;
    this.eventCounter += 1;
    return {
      id: extra.id ?? `${this.name}-evt-${this.eventCounter}`,
      taskId: run.task.id,
      runRef: { harness: this.name, runId },
      status,
      occurredAt: extra.occurredAt ?? this.clock().toISOString(),
      outcome: extra.outcome,
      error: extra.error,
      progress: extra.progress,
    };
  }

  private require(runId: string): LoopbackRun {
    const run = this.runs.get(runId);
    if (!run) throw new NotFound('harness run', runId);
    return run;
  }
}
