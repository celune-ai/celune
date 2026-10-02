import { ValidationError } from '../errors.ts';
import type { WorkspaceScope } from '../scope.ts';
import type {
  Claimant,
  JobListFilter,
  JobLogInput,
  JobLogRow,
  JobRow,
  JobRunner,
  Store,
} from '../store.ts';
import { ACTIVE_JOB_STATUSES } from '../store.ts';

const SUBMITTABLE = ['claimed', 'streaming'];

export interface EnqueueInput extends Record<string, unknown> {
  runner?: JobRunner;
  queue_name?: string;
}

export interface PollInput {
  queueName?: string;
  runner?: JobRunner;
  jobTypes?: string[];
  limit?: number;
}

export interface PollResult {
  jobs: JobRow[];
  queue_depth: number;
}

export type ClaimResult = { claimed: true; job: JobRow } | { claimed: false; reason: string };

export interface HeartbeatProgress {
  chunks_received?: number;
  tokens_so_far?: number;
  partial_result?: string;
}

export type OwnedJobResult =
  | { ok: true; job: JobRow }
  | { ok: false; reason: 'not_found' | 'not_owner' | 'bad_state'; status?: string };

export interface JobFailure {
  code: string;
  message: string;
  retryable?: boolean;
}

export interface SubmitInput {
  status: 'completed' | 'failed';
  /** Already-encrypted result columns; encryption stays with the host. */
  result?: { result_encrypted: string; result_iv: string };
  error?: JobFailure;
  /** Extra columns the runner tracks, such as tokens_used. */
  extra?: Record<string, unknown>;
}

export interface JobServiceOptions {
  clock?: () => Date;
}

const CLAIM_COLUMNS =
  'id, job_type, model, provider, runner, target_type, target_id, requester_id, org_id, workspace_id, priority, messages_encrypted, messages_iv, input_text_encrypted, input_text_iv, system_prompt_encrypted, system_prompt_iv, tools, output_schema, max_tokens, temperature, token_budget, start_to_close_ms, heartbeat_interval_ms, attempt, max_attempts, job_hmac, nonce, metadata, created_at';

const OWNED_COLUMNS =
  'id, job_type, model, nonce, workspace_id, claimed_by_key_id, worker_id, status, attempt, max_attempts';

/** Wraps the ai_job_queue state machine for both runners; queue semantics are unchanged. */
export class JobService {
  private readonly store: Store;
  private readonly clock: () => Date;

  constructor(store: Store, options: JobServiceOptions = {}) {
    this.store = store;
    this.clock = options.clock ?? (() => new Date());
  }

  /** Inserts a row the host already encrypted and signed. Defaults to the external runner. */
  enqueue(scope: WorkspaceScope, input: EnqueueInput): Promise<JobRow> {
    const { runner = 'external', queue_name = 'default', ...rest } = input;
    return this.store.jobs.enqueue(scope, { ...rest, runner, queue_name, status: 'pending' });
  }

  async poll(scope: WorkspaceScope, input: PollInput = {}): Promise<PollResult> {
    const queueName = input.queueName ?? 'default';
    const runner = input.runner ?? 'external';
    const jobs = await this.store.jobs.listPending(scope, {
      queueName,
      runner,
      jobTypes: input.jobTypes,
      limit: input.limit ?? 5,
    });
    const queue_depth = await this.store.jobs.countPending(scope, queueName, runner);
    return { jobs, queue_depth };
  }

  countActive(scope: WorkspaceScope, runner: JobRunner): Promise<number> {
    return this.store.jobs.countActive(scope, runner);
  }

  list(scope: WorkspaceScope, filter: JobListFilter = {}) {
    return this.store.jobs.list(scope, filter);
  }

  get(scope: WorkspaceScope, jobId: string, columns?: string): Promise<JobRow | null> {
    return this.store.jobs.get(scope, jobId, columns);
  }

  /** Newest job for a target that is still pending, claimed or streaming. */
  async findActive(
    scope: WorkspaceScope,
    target: { runner: JobRunner; targetType: 'task' | 'project'; targetId: string },
  ): Promise<JobRow | null> {
    const { rows } = await this.store.jobs.list(scope, {
      runner: target.runner,
      targetType: target.targetType,
      targetId: target.targetId,
      statuses: [...ACTIVE_JOB_STATUSES],
      limit: 1,
    });
    return rows[0] ?? null;
  }

  /** Metadata of a job before claiming it, for host-side eligibility checks. */
  async peekMetadata(scope: WorkspaceScope, jobId: string): Promise<Record<string, unknown>> {
    const job = await this.store.jobs.get(scope, jobId, 'metadata');
    const meta = job?.metadata;
    return typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>) : {};
  }

  async claim(scope: WorkspaceScope, jobId: string, claimant: Claimant): Promise<ClaimResult> {
    const job = await this.store.jobs.claim(scope, jobId, claimant, CLAIM_COLUMNS);
    if (!job) return { claimed: false, reason: 'Job already claimed or not found' };
    return { claimed: true, job };
  }

  async markFailed(scope: WorkspaceScope, jobId: string, error: JobFailure): Promise<void> {
    await this.store.jobs.update(scope, jobId, { status: 'failed', last_error: error });
  }

  async heartbeat(
    scope: WorkspaceScope,
    jobId: string,
    claimant: Claimant,
    progress?: HeartbeatProgress,
  ): Promise<{ continue: boolean }> {
    const now = this.clock().toISOString();
    const patch: Record<string, unknown> = { last_heartbeat_at: now };
    if (progress) {
      patch.status = 'streaming';
      patch.started_at = now;
    }
    const job = await this.store.jobs.heartbeat(scope, jobId, claimant, patch);
    if (!job) return { continue: false };

    if (progress?.partial_result) {
      const current =
        typeof job.metadata === 'object' && job.metadata !== null
          ? (job.metadata as Record<string, unknown>)
          : {};
      const saved = await this.store.jobs.heartbeat(scope, jobId, claimant, {
        metadata: {
          ...current,
          _checkpoint: progress.partial_result,
          _checkpoint_tokens: progress.tokens_so_far,
        },
      });
      if (!saved) return { continue: false };
    }

    return { continue: job.status !== 'cancelled' };
  }

  /** Loads a job the claimant owns in a submittable state; hosts verify HMAC on the row. */
  async getOwned(
    scope: WorkspaceScope,
    jobId: string,
    claimant: Claimant,
  ): Promise<OwnedJobResult> {
    const job = await this.store.jobs.get(scope, jobId, OWNED_COLUMNS);
    if (!job) return { ok: false, reason: 'not_found' };
    if (!ownedBy(job, claimant)) return { ok: false, reason: 'not_owner' };
    if (!SUBMITTABLE.includes(job.status))
      return { ok: false, reason: 'bad_state', status: job.status };
    return { ok: true, job };
  }

  async submitResult(scope: WorkspaceScope, job: JobRow, input: SubmitInput): Promise<void> {
    const now = this.clock();
    const patch: Record<string, unknown> = {
      ...input.extra,
      status: input.status,
      completed_at: now.toISOString(),
    };

    if (input.status === 'completed' && input.result) {
      patch.result_encrypted = input.result.result_encrypted;
      patch.result_iv = input.result.result_iv;
    }

    if (input.status === 'failed' && input.error) {
      patch.last_error = input.error;
      if (input.error.retryable) {
        const attempt = Number(job.attempt ?? 0);
        const maxAttempts = Number(job.max_attempts ?? 0);
        if (attempt < maxAttempts) {
          patch.status = 'pending';
          patch.attempt = attempt + 1;
          patch.claimed_by_key_id = null;
          patch.worker_id = null;
          patch.claimed_at = null;
          patch.started_at = null;
          patch.completed_at = null;
          patch.retry_after = new Date(now.getTime() + Math.pow(2, attempt) * 5000).toISOString();
        }
      }
    }

    await this.store.jobs.submitResult(scope, job.id, patch);
  }

  /** Cancels an active job; the next heartbeat tells the runner to stop. */
  /** Server runs (the in-process worker's jobs), optionally for one task. */
  listRuns(
    scope: WorkspaceScope,
    filter: { taskId?: string; status?: string; limit?: number; offset?: number } = {},
  ): Promise<{ rows: JobRow[]; total: number }> {
    return this.store.jobs.list(scope, {
      runner: 'server',
      statuses: filter.status ? [filter.status] : undefined,
      targetType: filter.taskId ? 'task' : undefined,
      targetId: filter.taskId,
      limit: filter.limit ?? 20,
      offset: filter.offset ?? 0,
    });
  }

  /**
   * Cancels a server run by its id, or the active run for a task. Resolves null
   * when nothing active matched; an in-flight worker stops at its next heartbeat.
   */
  async cancelRun(
    scope: WorkspaceScope,
    target: { executionId?: string; taskId?: string },
  ): Promise<JobRow | null> {
    let jobId: string;
    if (target.executionId) {
      const job = await this.store.jobs.get(scope, target.executionId, 'id, runner');
      if (!job || job.runner !== 'server') return null;
      jobId = job.id;
    } else if (target.taskId) {
      const active = await this.findActive(scope, {
        runner: 'server',
        targetType: 'task',
        targetId: target.taskId,
      });
      if (!active) return null;
      jobId = active.id;
    } else {
      throw new ValidationError('Provide task_id or execution_id');
    }
    return this.cancel(scope, jobId);
  }

  async cancel(scope: WorkspaceScope, jobId: string): Promise<JobRow | null> {
    return this.store.jobs.cancel(scope, jobId, {
      status: 'cancelled',
      completed_at: this.clock().toISOString(),
      last_error: { code: 'cancelled', message: 'Cancelled by request' },
    });
  }

  async nextPending(scope: WorkspaceScope, runner: JobRunner = 'external'): Promise<JobRow | null> {
    const jobs = await this.store.jobs.listPending(scope, {
      queueName: 'default',
      runner,
      limit: 1,
    });
    return jobs[0] ?? null;
  }

  expire(scope: WorkspaceScope, staleBefore: string): Promise<number> {
    return this.store.jobs.expire(scope, staleBefore);
  }

  appendLog(scope: WorkspaceScope, entry: JobLogInput): Promise<JobLogRow> {
    return this.store.jobs.appendLog(scope, entry);
  }

  listLogs(
    scope: WorkspaceScope,
    jobId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<JobLogRow[]> {
    return this.store.jobs.listLogs(scope, jobId, opts);
  }
}

export function ownedBy(job: JobRow, claimant: Claimant): boolean {
  return 'keyId' in claimant
    ? job.claimed_by_key_id === claimant.keyId
    : job.worker_id === claimant.workerId;
}
