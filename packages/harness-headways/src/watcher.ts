import { isTerminalRunStatus, type HarnessRunStatus } from '@celuneai/core';
import type { HeadwaysClient, HeadwaysRun } from './headways-client.ts';
import type { ActiveRunReport, CeluneEventReporter, RunEventReport } from './reporter.ts';
import { eventIdFor, occurrencesFromEventIds, toHarnessRunStatus } from './status.ts';

const OUTCOME_MAX = 20_000;
const ERROR_MAX = 4_000;
const DEFAULT_INTERVAL_MS = 5_000;

/** Reason sent with the failed event when Headways no longer has the run. */
export const RUN_NOT_FOUND = 'run_not_found';

interface TrackedRun {
  runId: string;
  taskId: string;
  client: HeadwaysClient;
  last: HarnessRunStatus;
  lastAt: string | null;
  occurrences: Map<HarnessRunStatus, number>;
  /** Consecutive polls that found no AgentRun. */
  notFound: number;
  /** Consecutive failed checks, for backoff. */
  failures: number;
  /** Epoch ms before which the run is not checked again. */
  retryAt: number;
}

export interface RunWatcherOptions {
  harness: string;
  reporter: Pick<CeluneEventReporter, 'report' | 'listActiveRuns'>;
  clock?: () => Date;
  /** `runId` is null when the resync itself failed. */
  onError?: (error: unknown, runId: string | null) => void;
  /** Consecutive not-found polls before the run is reported failed. Default 3. */
  notFoundLimit?: number;
  /** Longest wait between checks of a failing run. Default 5 minutes. */
  maxBackoffMs?: number;
  /** Checks refused with a permanent 4xx before the run is dropped. Default 3. */
  clientErrorLimit?: number;
}

export interface RunWatcherStartOptions {
  /** How often tracked runs are polled. */
  intervalMs?: number;
  /** How often the tracked set is rebuilt from Celune. 0 turns the periodic resync off. */
  resyncMs?: number;
}

/** Picks the Headways client that reads a run the watcher did not start. */
export type RunClientResolver = (run: ActiveRunReport) => HeadwaysClient;

/** Builds the Celune event for one AgentRun snapshot. */
export function eventFromRun(
  harness: string,
  taskId: string,
  run: HeadwaysRun,
  occurrence: number,
  now: Date,
  after: string | null = null,
): RunEventReport {
  const status = toHarnessRunStatus(run.status);
  // Non-terminal states have no timestamp of their own on AgentRun, so they use
  // the time the watcher saw them. A terminal endedAt never lands before the last report.
  const ended = isTerminalRunStatus(status) ? run.endedAt : null;
  const occurredAt =
    ended && (!after || Date.parse(ended) > Date.parse(after)) ? ended : now.toISOString();
  return {
    eventId: eventIdFor(run.id, status, occurrence),
    taskId,
    harness,
    runId: run.id,
    status,
    occurredAt,
    outcome: status === 'succeeded' ? clamp(run.narration, OUTCOME_MAX) : null,
    error:
      status === 'failed' || status === 'timed_out'
        ? clamp(run.failureReason, ERROR_MAX)
        : status === 'cancelled'
          ? clamp(run.cancellationReason, ERROR_MAX)
          : null,
    progress: {
      tokens_input: run.tokensInput,
      tokens_output: run.tokensOutput,
      cost_usd: run.costUsd,
      budget_usd_max: run.budgetUsdMax,
      workstream_id: run.workstreamId,
    },
  };
}

/**
 * Reports AgentRun status changes to Celune. Runs in the Headways API process
 * beside the adapter; each status change becomes one event with a stable id,
 * and Celune dedupes retries on that id.
 */
export class HeadwaysRunWatcher {
  private readonly runs = new Map<string, TrackedRun>();
  private readonly options: RunWatcherOptions;
  private readonly clock: () => Date;
  private timer: ReturnType<typeof setInterval> | null = null;
  private resyncTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private resolveClient: RunClientResolver | null = null;
  private intervalMs = DEFAULT_INTERVAL_MS;
  /** Runs with a cancel in flight. The cancel reports their ending, so the watcher leaves them alone. */
  private readonly cancelling = new Set<string>();
  /** Runs dropped after permanent errors, so a resync does not pick them up again. */
  private readonly dropped = new Set<string>();

  constructor(options: RunWatcherOptions) {
    this.options = options;
    this.clock = options.clock ?? (() => new Date());
  }

  /** Set by HeadwaysHarness, which holds the API keys. Resync needs it. */
  useClients(resolve: RunClientResolver): void {
    this.resolveClient = resolve;
  }

  track(runId: string, taskId: string, client: HeadwaysClient): void {
    if (this.runs.has(runId) || this.cancelling.has(runId)) return;
    this.runs.set(runId, {
      runId,
      taskId,
      client,
      last: 'queued',
      lastAt: null,
      occurrences: new Map([['queued', 1]]),
      notFound: 0,
      failures: 0,
      retryAt: 0,
    });
  }

  untrack(runId: string): void {
    this.runs.delete(runId);
  }

  /**
   * Stops watching a run while its cancel is in flight and keeps a resync from
   * tracking it again. Call the returned function once the cancel settles.
   */
  beginCancel(runId: string): () => void {
    this.runs.delete(runId);
    this.cancelling.add(runId);
    return () => this.cancelling.delete(runId);
  }

  tracked(): string[] {
    return [...this.runs.keys()];
  }

  /** Checks every tracked run once and reports each change. Resolves the events sent. */
  async pollOnce(): Promise<RunEventReport[]> {
    return this.checkAll(() => {
      const now = this.clock().getTime();
      return [...this.runs.values()].filter((run) => run.retryAt <= now);
    });
  }

  /**
   * Rebuilds the tracked set from Celune: every run Celune records as active
   * for this harness and workspace is tracked again, starting from the status
   * and event ids Celune last applied, then checked once. A run that ended
   * while nothing watched it is reported now with its stable terminal event id.
   */
  async resync(): Promise<RunEventReport[]> {
    const resolve = this.resolveClient;
    if (!resolve) {
      throw new Error('Watcher has no Headways client; pass it to HeadwaysHarness first');
    }
    return this.checkAll(async () => {
      const active = await this.options.reporter.listActiveRuns(this.options.harness);
      const resumed: TrackedRun[] = [];
      for (const run of active) {
        if (
          run.harness !== this.options.harness ||
          this.runs.has(run.run_id) ||
          this.cancelling.has(run.run_id) ||
          this.dropped.has(run.run_id)
        ) {
          continue;
        }
        const occurrences = occurrencesFromEventIds(run.run_id, run.event_ids);
        if (!occurrences.has(run.status)) occurrences.set(run.status, 1);
        const tracked: TrackedRun = {
          runId: run.run_id,
          taskId: run.task_id,
          client: resolve(run),
          last: run.status,
          lastAt: run.last_event_at,
          occurrences,
          notFound: 0,
          failures: 0,
          retryAt: 0,
        };
        this.runs.set(run.run_id, tracked);
        resumed.push(tracked);
      }
      return resumed;
    });
  }

  /** Resyncs from Celune at once and on `resyncMs`, and polls on `intervalMs`. */
  start(options: number | RunWatcherStartOptions = {}): void {
    if (this.timer) return;
    const { intervalMs = DEFAULT_INTERVAL_MS, resyncMs = 60_000 } =
      typeof options === 'number' ? { intervalMs: options } : options;
    this.intervalMs = intervalMs;
    const resync = () =>
      this.resync().catch((error: unknown) => this.options.onError?.(error, null));
    if (this.resolveClient) {
      void resync();
      if (resyncMs > 0) this.resyncTimer = setInterval(() => void resync(), resyncMs);
    }
    this.timer = setInterval(() => void this.pollOnce(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.resyncTimer) clearInterval(this.resyncTimer);
    this.timer = null;
    this.resyncTimer = null;
  }

  /** One pass at a time, so a resync and a poll never report the same change twice. */
  private async checkAll(
    select: () => TrackedRun[] | Promise<TrackedRun[]>,
  ): Promise<RunEventReport[]> {
    if (this.polling) return [];
    this.polling = true;
    const sent: RunEventReport[] = [];
    try {
      for (const tracked of await select()) {
        try {
          const event = await this.check(tracked);
          tracked.failures = 0;
          tracked.retryAt = 0;
          if (event) sent.push(event);
        } catch (error) {
          this.failed(tracked, error);
        }
      }
    } finally {
      this.polling = false;
    }
    return sent;
  }

  /** Backs off exponentially, and drops the run after repeated permanent refusals. */
  private failed(tracked: TrackedRun, error: unknown): void {
    this.options.onError?.(error, tracked.runId);
    tracked.failures += 1;
    if (isPermanent(error) && tracked.failures >= (this.options.clientErrorLimit ?? 3)) {
      this.runs.delete(tracked.runId);
      this.dropped.add(tracked.runId);
      this.options.onError?.(
        new Error(`Stopped watching run ${tracked.runId} after ${tracked.failures} refused checks`),
        tracked.runId,
      );
      return;
    }
    const wait = Math.min(
      this.options.maxBackoffMs ?? 300_000,
      this.intervalMs * 2 ** (tracked.failures - 1),
    );
    tracked.retryAt = this.clock().getTime() + wait;
  }

  private async check(tracked: TrackedRun): Promise<RunEventReport | null> {
    const run = await tracked.client.getRun(tracked.runId);
    if (!run) return this.missing(tracked);
    tracked.notFound = 0;
    const status = toHarnessRunStatus(run.status);
    if (status === tracked.last) return null;

    // A run ends once, so its terminal event id never carries a counter.
    const occurrence = isTerminalRunStatus(status) ? 1 : (tracked.occurrences.get(status) ?? 0) + 1;
    const event = eventFromRun(
      this.options.harness,
      tracked.taskId,
      run,
      occurrence,
      this.clock(),
      tracked.lastAt,
    );
    await this.options.reporter.report(event);
    tracked.occurrences.set(status, occurrence);
    tracked.last = status;
    tracked.lastAt = event.occurredAt;
    if (isTerminalRunStatus(status)) this.runs.delete(tracked.runId);
    return event;
  }

  /**
   * Headways has no AgentRun for this id. That is normal for a moment after the
   * run is created; after `notFoundLimit` polls in a row the run is reported
   * failed and no longer watched.
   */
  private async missing(tracked: TrackedRun): Promise<RunEventReport | null> {
    tracked.notFound += 1;
    if (tracked.notFound < (this.options.notFoundLimit ?? 3)) return null;
    const event: RunEventReport = {
      eventId: eventIdFor(tracked.runId, 'failed', 1),
      taskId: tracked.taskId,
      harness: this.options.harness,
      runId: tracked.runId,
      status: 'failed',
      occurredAt: this.clock().toISOString(),
      outcome: null,
      error: RUN_NOT_FOUND,
    };
    await this.options.reporter.report(event);
    this.runs.delete(tracked.runId);
    this.options.onError?.(
      new Error(`Headways has no run ${tracked.runId}; reported it failed`),
      tracked.runId,
    );
    return event;
  }
}

/** A 4xx that retrying will not fix. 408 and 429 are worth another try. */
function isPermanent(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return (
    typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429
  );
}

function clamp(value: string | null, max: number): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}
