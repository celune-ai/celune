import type { HarnessRunStatus } from '@celuneai/core';
import { DEFAULT_REQUEST_TIMEOUT_MS, type FetchLike } from './headways-client.ts';
import { mintServerToken, type ServerTokenOptions } from './tokens.ts';

export interface RunEventReport {
  eventId: string;
  taskId: string;
  harness: string;
  runId: string;
  status: HarnessRunStatus;
  occurredAt: string;
  outcome?: string | null;
  error?: string | null;
  progress?: Record<string, unknown>;
}

export interface ReportResult {
  applied: boolean;
  duplicate: boolean;
  stale: boolean;
  task_id: string;
  task_status: string;
  run_status?: string;
}

/** One entry of GET /v1/harness/runs: a run Celune still records as active. */
export interface ActiveRunReport {
  task_id: string;
  harness: string;
  run_id: string;
  harness_agent: string | null;
  status: HarnessRunStatus;
  last_event_at: string | null;
  event_ids: string[];
  /** Email of the Headways user the run was started as; null for the org owner. */
  run_as?: string | null;
}

export interface CeluneEventReporterOptions {
  /** Celune API origin, for example http://localhost:4000. The route is /v1/harness/events. */
  apiUrl: string;
  workspaceId: string;
  orgId?: string | null;
  /** Principal the reporter acts as. Use a Celune user id so activity rows attribute cleanly. */
  subject: string;
  jwt: ServerTokenOptions;
  fetch?: FetchLike;
  clock?: () => Date;
  /** Per-request timeout. Default 15 s. */
  timeoutMs?: number;
}

/** Celune answered a report or run list with a non-2xx status. */
export class CeluneReportError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'CeluneReportError';
    this.status = status;
  }
}

/** Posts run events to Celune with a short-lived server JWT, minted again before it expires. */
export class CeluneEventReporter {
  private readonly options: CeluneEventReporterOptions;
  private readonly fetchImpl: FetchLike;
  private readonly clock: () => Date;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(options: CeluneEventReporterOptions) {
    this.options = options;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.clock = options.clock ?? (() => new Date());
  }

  async report(event: RunEventReport): Promise<ReportResult> {
    const response = await this.fetchImpl(
      `${this.options.apiUrl.replace(/\/$/, '')}/v1/harness/events`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.bearer()}`,
          'content-type': 'application/json',
        },
        signal: this.signal(),
        body: JSON.stringify({
          event_id: event.eventId,
          task_id: event.taskId,
          harness: event.harness,
          run_id: event.runId,
          status: event.status,
          occurred_at: event.occurredAt,
          outcome: event.outcome ?? null,
          error: event.error ?? null,
          ...(event.progress ? { progress: event.progress } : {}),
        }),
      },
    );
    const text = await response.text();
    if (!response.ok) {
      throw new CeluneReportError(
        response.status,
        `Celune rejected event ${event.eventId}: ${response.status} ${text.slice(0, 300)}`,
      );
    }
    return JSON.parse(text) as ReportResult;
  }

  /** Runs of this harness that Celune records as active in the reporter's workspace. */
  async listActiveRuns(harness: string): Promise<ActiveRunReport[]> {
    const response = await this.fetchImpl(
      `${this.options.apiUrl.replace(/\/$/, '')}/v1/harness/runs?harness=${encodeURIComponent(harness)}`,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${await this.bearer()}` },
        signal: this.signal(),
      },
    );
    const text = await response.text();
    if (!response.ok) {
      throw new CeluneReportError(
        response.status,
        `Celune refused the active run list: ${response.status} ${text.slice(0, 300)}`,
      );
    }
    return (JSON.parse(text) as { runs: ActiveRunReport[] }).runs;
  }

  private signal(): AbortSignal {
    return AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  }

  private async bearer(): Promise<string> {
    const now = this.clock().getTime();
    if (this.token && this.token.expiresAt - now > 60_000) return this.token.value;
    const ttl = this.options.jwt.expiresInSeconds ?? 600;
    const value = await mintServerToken(
      {
        sub: this.options.subject,
        workspaceId: this.options.workspaceId,
        orgId: this.options.orgId ?? null,
      },
      { ...this.options.jwt, expiresInSeconds: ttl },
    );
    this.token = { value, expiresAt: now + ttl * 1000 };
    return value;
  }
}
