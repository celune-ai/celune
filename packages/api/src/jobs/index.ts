import type { JobRow, Services, WorkspaceScope } from '@celuneai/core';
import type { AuthContext } from '../auth/types.ts';
import type { ApiHost } from '../host.ts';

/** Shared by the REST handlers and the MCP tools so both answer the same way. */
export interface JobCallContext {
  auth: AuthContext;
  services: Services;
  host: ApiHost;
  scope: WorkspaceScope;
}

export type JobOutcome<T> =
  { ok: true; status: number; body: T } | { ok: false; status: number; error: string };

const SECRET_COLUMN = /(_encrypted|_iv)$|^job_hmac$/;

/** Strips ciphertext, IVs, and the HMAC from a row before it leaves the server. */
export function redactJob(job: JobRow): JobRow {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(job)) {
    if (!SECRET_COLUMN.test(key)) out[key] = value;
  }
  return out as JobRow;
}

function claimantFor(auth: AuthContext): { keyId: string } | null {
  return auth.keyId ? { keyId: auth.keyId } : null;
}

export async function claimJob(
  ctx: JobCallContext,
  jobId: string,
): Promise<JobOutcome<Record<string, unknown>>> {
  const claimant = claimantFor(ctx.auth);
  if (!claimant) return { ok: false, status: 403, error: 'An API key is required to claim jobs' };
  const crypto = ctx.host.jobs?.crypto;
  if (!crypto) {
    return {
      ok: false,
      status: 501,
      error: 'Job payload decryption is not configured on this host',
    };
  }
  const { jobs } = ctx.services;

  const meta = await jobs.peekMetadata(ctx.scope, jobId);
  const targetAgent = (meta.agent_id ?? meta.assignee) as string | undefined;
  if (targetAgent && ctx.host.agents?.isEmployed) {
    const employed = await ctx.host.agents.isEmployed(ctx.scope.workspaceId, targetAgent);
    if (!employed) {
      return {
        ok: false,
        status: 403,
        error: `Agent "${targetAgent}" is not employed in this workspace. Enable the agent on the Agents page first.`,
      };
    }
  }

  const claim = await jobs.claim(ctx.scope, jobId, claimant);
  if (!claim.claimed) {
    // A job outside the caller's workspace reads as missing, never as someone else's claim.
    if (!(await jobs.get(ctx.scope, jobId)))
      return { ok: false, status: 404, error: 'Job not found' };
    return { ok: false, status: 409, error: 'Job is already claimed' };
  }

  const job = claim.job as Record<string, string | null | undefined> & { id: string };
  let messages: unknown = null;
  let inputText: string | null = null;
  let systemPrompt: string | null = null;
  try {
    if (job.messages_encrypted && job.messages_iv) {
      messages = JSON.parse(crypto.decrypt(job.messages_encrypted, job.messages_iv));
    }
    if (job.input_text_encrypted && job.input_text_iv) {
      inputText = crypto.decrypt(job.input_text_encrypted, job.input_text_iv);
    }
    if (job.system_prompt_encrypted && job.system_prompt_iv) {
      systemPrompt = crypto.decrypt(job.system_prompt_encrypted, job.system_prompt_iv);
    }
  } catch (decryptError) {
    await jobs.markFailed(ctx.scope, jobId, {
      code: 'decryption_failed',
      message: decryptError instanceof Error ? decryptError.message : 'Unknown error',
    });
    return { ok: false, status: 500, error: 'Failed to decrypt job payload; job marked as failed' };
  }

  return {
    ok: true,
    status: 200,
    body: {
      claimed: true,
      job: {
        id: job.id,
        job_type: job.job_type,
        model: job.model,
        provider: job.provider,
        messages,
        input_text: inputText,
        system_prompt: systemPrompt,
        tools: job.tools,
        output_schema: job.output_schema,
        max_tokens: job.max_tokens,
        temperature: job.temperature,
        job_hmac: job.job_hmac,
        nonce: job.nonce,
        metadata: job.metadata,
      },
    },
  };
}

export interface HeartbeatInput {
  chunks_received?: number;
  tokens_so_far?: number;
  partial_result?: string;
}

export async function heartbeatJob(
  ctx: JobCallContext,
  jobId: string,
  progress?: HeartbeatInput,
): Promise<JobOutcome<{ continue: boolean; reason?: string }>> {
  const claimant = claimantFor(ctx.auth);
  if (!claimant) return { ok: false, status: 403, error: 'An API key is required to run jobs' };
  const result = await ctx.services.jobs.heartbeat(ctx.scope, jobId, claimant, progress);
  if (!result.continue) {
    // A job outside the caller's workspace reads as missing, never as someone else's job.
    if (!(await ctx.services.jobs.get(ctx.scope, jobId)))
      return { ok: false, status: 404, error: 'Job not found' };
    return {
      ok: true,
      status: 200,
      body: {
        continue: false,
        reason: 'Job not found, not claimed by you, or already completed/cancelled',
      },
    };
  }
  return { ok: true, status: 200, body: { continue: true } };
}

export interface SubmitJobInput {
  status: 'completed' | 'failed';
  job_hmac: string;
  nonce: string;
  result?: Record<string, unknown>;
  error?: { code: string; message: string; retryable: boolean };
}

export async function submitJobResult(
  ctx: JobCallContext,
  jobId: string,
  input: SubmitJobInput,
): Promise<JobOutcome<{ acknowledged: true; next_job: JobRow | null }>> {
  const claimant = claimantFor(ctx.auth);
  if (!claimant) return { ok: false, status: 403, error: 'An API key is required to run jobs' };
  const crypto = ctx.host.jobs?.crypto;
  if (!crypto) {
    return {
      ok: false,
      status: 501,
      error: 'Job result encryption is not configured on this host',
    };
  }
  const { jobs } = ctx.services;

  const owned = await jobs.getOwned(ctx.scope, jobId, claimant);
  if (!owned.ok) {
    if (owned.reason === 'not_found') {
      return { ok: false, status: 404, error: 'Job not found or access denied' };
    }
    if (owned.reason === 'not_owner') {
      return {
        ok: false,
        status: 403,
        error: 'Only the client that claimed this job can submit results',
      };
    }
    return {
      ok: false,
      status: 409,
      error: `Job is in status '${owned.status}'; cannot submit results`,
    };
  }

  const job = owned.job;
  const { job_type: jobType, model, nonce, workspace_id: workspaceId } = job;
  const hmacValid =
    typeof jobType === 'string' &&
    typeof model === 'string' &&
    typeof nonce === 'string' &&
    typeof workspaceId === 'string' &&
    crypto.verifyHmac({ jobId: job.id, jobType, model, nonce, workspaceId }, input.job_hmac);
  if (!hmacValid) {
    return {
      ok: false,
      status: 403,
      error: 'HMAC verification failed; job payload may have been tampered with',
    };
  }
  if (input.nonce !== job.nonce) {
    return { ok: false, status: 403, error: 'Nonce mismatch; replay attack suspected' };
  }

  const encrypted =
    input.status === 'completed' && input.result
      ? crypto.encrypt(JSON.stringify(input.result))
      : undefined;
  await jobs.submitResult(ctx.scope, owned.job, {
    status: input.status,
    result: encrypted,
    error: input.error,
  });

  if (input.status === 'completed' && ctx.host.jobs?.onCompleted) {
    try {
      await ctx.host.jobs.onCompleted(ctx.scope, jobId);
    } catch (err) {
      console.error(`[celune-api] job callback failed for ${jobId}:`, err);
    }
  }

  const nextJob = await jobs.nextPending(ctx.scope);
  return { ok: true, status: 200, body: { acknowledged: true, next_job: nextJob } };
}
