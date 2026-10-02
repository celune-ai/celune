/**
 * Server-run helpers over the single ai_job_queue.
 *
 * Server runs (runner = 'server') are agent_run jobs that the in-process
 * worker claims through JobService, the same path polling agents use.
 */

import { createServiceClient } from '@repo/db/service';
import type { ExecutionJob, ExecutionLimits } from '@repo/types';
import { EXECUTION_TIER_LIMITS } from '@repo/types';
import { toExecutionView as coreExecutionView } from '@celuneai/core';
import type { JobRow, Services, WorkspaceScope } from '@celuneai/core';
import { resolveWorkspacePlan } from '@/lib/plan-enforcement';
import { decryptPayload, signJobHmac } from '@/lib/ai-job-queue/crypto';
import { getCoreServices, workspaceScope } from '@/lib/core';

export const SERVER_RUN_MODEL = 'claude-sonnet-4-6';
const SERVER_HEARTBEAT_MS = 60_000;
const SERVER_SCHEDULE_TO_START_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve execution limits for a workspace based on its plan.
 */
export async function getExecutionLimits(
  workspaceId: string,
  userId?: string,
): Promise<ExecutionLimits> {
  const resolved = await resolveWorkspacePlan(workspaceId, userId);
  const planKey = resolved.isPlatformOwner ? 'platform_owner' : resolved.plan;
  return EXECUTION_TIER_LIMITS[planKey] ?? EXECUTION_TIER_LIMITS.cloud;
}

/**
 * Check if a workspace can start a new server run (concurrency limit).
 */
export async function canStartExecution(
  workspaceId: string,
  userId?: string,
  services: Services = getCoreServices(createServiceClient()),
): Promise<{ allowed: boolean; current: number; limit: number }> {
  const limits = await getExecutionLimits(workspaceId, userId);
  const current = await services.jobs.countActive(workspaceScope({ workspaceId }), 'server');

  return {
    allowed: current < limits.max_concurrent,
    current,
    limit: limits.max_concurrent,
  };
}

export interface ServerRunOptions {
  workspaceId: string;
  userId: string;
  orgId: string;
  targetType: 'task' | 'project';
  taskId?: string;
  projectId?: string;
  agentId?: string;
  priority?: number;
  systemPrompt?: string;
  tools?: unknown[];
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Enqueue a server run. Checks concurrency limits, signs the job, and
 * inserts it through JobService so the worker can claim it like any job.
 */
export async function enqueueServerRun(
  opts: ServerRunOptions,
  services: Services = getCoreServices(createServiceClient()),
): Promise<{ job: { id: string; status: string } | null; error?: string }> {
  if (!opts.userId) {
    return { job: null, error: 'A requester is required to enqueue a server run.' };
  }

  const { allowed, current, limit } = await canStartExecution(
    opts.workspaceId,
    opts.userId,
    services,
  );
  if (!allowed) {
    return {
      job: null,
      error: `Concurrency limit reached (${current}/${limit}). Wait for an active execution to complete.`,
    };
  }

  const limits = await getExecutionLimits(opts.workspaceId, opts.userId);
  const scope = workspaceScope({
    workspaceId: opts.workspaceId,
    orgId: opts.orgId,
    actorId: opts.userId,
  });

  const jobId = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const targetId = opts.targetType === 'task' ? opts.taskId : opts.projectId;
  if (!targetId) {
    return { job: null, error: `A ${opts.targetType} id is required for a server run.` };
  }

  const job = await services.jobs.enqueue(scope, {
    id: jobId,
    runner: 'server',
    org_id: opts.orgId,
    requester_id: opts.userId,
    job_type: 'agent_run',
    model: SERVER_RUN_MODEL,
    provider: 'anthropic',
    priority: opts.priority ?? 0,
    target_type: opts.targetType,
    target_id: targetId,
    tools: opts.tools ?? [],
    max_tokens: 4096,
    token_budget: limits.token_budget,
    schedule_to_start_ms: SERVER_SCHEDULE_TO_START_MS,
    start_to_close_ms: limits.timeout_ms,
    heartbeat_interval_ms: SERVER_HEARTBEAT_MS,
    max_attempts: limits.max_retries,
    metadata: {
      ...(opts.metadata ?? {}),
      agent_id: opts.agentId ?? 'rick',
      context: opts.context ?? {},
      ...(opts.systemPrompt ? { system_prompt: opts.systemPrompt } : {}),
    },
    job_hmac: signJobHmac({
      jobId,
      jobType: 'agent_run',
      model: SERVER_RUN_MODEL,
      nonce,
      workspaceId: opts.workspaceId,
    }),
    nonce,
  });

  return { job: { id: job.id, status: job.status } };
}

/** Cancels a server run; an in-flight worker stops at its next heartbeat. */
export async function cancelServerRun(
  scope: WorkspaceScope,
  jobId: string,
  services: Services = getCoreServices(createServiceClient()),
): Promise<ExecutionJob | null> {
  const row = await services.jobs.cancel(scope, jobId);
  return row ? toExecutionView(row) : null;
}

/** Maps a server job row to the shape the Executions API has always returned. */
export function toExecutionView(row: JobRow): ExecutionJob {
  return coreExecutionView(row, (enc, iv) => decryptPayload(hexToBuffer(enc), hexToBuffer(iv)));
}

function hexToBuffer(hex: string): Buffer {
  const clean = hex.startsWith('\\x') ? hex.slice(2) : hex;
  return Buffer.from(clean, 'hex');
}
