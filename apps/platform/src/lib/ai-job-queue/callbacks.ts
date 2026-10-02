/**
 * Job Result Callback Dispatcher.
 *
 * When an AI job completes, this dispatcher routes the decrypted result
 * to the appropriate feature handler based on `callback_type`.
 *
 * Each callback handler receives the decrypted result and callback metadata,
 * then performs feature-specific processing (store PR review, update task, etc.).
 */

import type { createServiceClient } from '@repo/db/service';

type ServiceClient = ReturnType<typeof createServiceClient>;
import { decryptPayload } from './crypto';

/** Result shape after decryption. */
export interface JobResult {
  content: string;
  tool_calls?: unknown[];
  usage?: { input_tokens: number; output_tokens: number };
  model?: string;
  finish_reason?: string;
}

/** Context passed to each callback handler. */
export interface CallbackContext {
  jobId: string;
  workspaceId: string;
  orgId: string;
  requesterId: string;
  result: JobResult;
  callbackMetadata: Record<string, unknown>;
  supabase: ServiceClient;
}

/** Callback handler function signature. */
type CallbackHandler = (ctx: CallbackContext) => Promise<void>;

/**
 * Registry of callback handlers by type.
 * TODO(Sprint 2): Wire real implementations — these are stubs and Sprint 2 wiring targets.
 */
const callbackHandlers: Record<string, CallbackHandler> = {
  // Sprint 2: Wire these to real feature handlers
  agent_chat: async (ctx) => {
    // Will: update conversation_logs, send SSE to web UI
    console.log(`[job-callback] agent_chat completed for job ${ctx.jobId}`);
  },

  task_gen: async (ctx) => {
    // Will: parse AI output into task(s), insert into tasks table
    console.log(`[job-callback] task_gen completed for job ${ctx.jobId}`);
  },

  pr_review: async (ctx) => {
    // Will: parse review, post GitHub comments, update project_prs
    console.log(`[job-callback] pr_review completed for job ${ctx.jobId}`);
  },

  support_chat: async (ctx) => {
    // Will: update support_tickets, notify via Slack
    console.log(`[job-callback] support_chat completed for job ${ctx.jobId}`);
  },

  slack_notify: async (ctx) => {
    // Will: format and send Slack notification
    console.log(`[job-callback] slack_notify completed for job ${ctx.jobId}`);
  },

  memory_embed: async (ctx) => {
    // Will: store embedding result in agent_memory
    console.log(`[job-callback] memory_embed completed for job ${ctx.jobId}`);
  },
};

/**
 * Process a completed job: decrypt result, dispatch to callback handler.
 *
 * Called after submit_job_result confirms a completed job.
 * Can also be called by a periodic sweep for jobs that completed
 * but whose callback wasn't triggered (belt + suspenders).
 */
export async function dispatchJobCallback(
  supabase: ServiceClient,
  jobId: string,
): Promise<{ dispatched: boolean; callbackType: string | null; error?: string }> {
  // Fetch the completed job
  const { data: job, error: fetchError } = await supabase
    .from('ai_job_queue')
    .select(
      'id, workspace_id, org_id, requester_id, callback_type, callback_metadata, result_encrypted, result_iv',
    )
    .eq('id', jobId)
    .eq('status', 'completed')
    .single();

  if (fetchError || !job) {
    return { dispatched: false, callbackType: null, error: 'Job not found or not completed' };
  }

  // No callback registered — nothing to dispatch
  if (!job.callback_type) {
    return { dispatched: false, callbackType: null };
  }

  // Find the handler
  const handler = callbackHandlers[job.callback_type];
  if (!handler) {
    return {
      dispatched: false,
      callbackType: job.callback_type,
      error: `No handler registered for callback_type '${job.callback_type}'`,
    };
  }

  // Decrypt the result
  let result: JobResult;
  try {
    if (!job.result_encrypted || !job.result_iv) {
      return {
        dispatched: false,
        callbackType: job.callback_type,
        error: 'Job has no encrypted result',
      };
    }
    const encBuf = hexToBuffer(job.result_encrypted);
    const ivBuf = hexToBuffer(job.result_iv);
    result = JSON.parse(decryptPayload(encBuf, ivBuf));
  } catch (err) {
    return {
      dispatched: false,
      callbackType: job.callback_type,
      error: `Failed to decrypt result: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }

  // Dispatch
  try {
    await handler({
      jobId: job.id,
      workspaceId: job.workspace_id,
      orgId: job.org_id,
      requesterId: job.requester_id,
      result,
      callbackMetadata: job.callback_metadata ?? {},
      supabase,
    });
    return { dispatched: true, callbackType: job.callback_type };
  } catch (err) {
    // Log full error for server-side debugging, but sanitize what's returned
    console.error(`[job-callback] Handler '${job.callback_type}' failed for job ${jobId}:`, err);
    return {
      dispatched: false,
      callbackType: job.callback_type,
      error: 'Callback handler failed — see server logs for details',
    };
  }
}

/**
 * Register a custom callback handler.
 * Used by feature modules to wire their handlers at startup.
 */
export function registerCallbackHandler(type: string, handler: CallbackHandler): void {
  callbackHandlers[type] = handler;
}

/** Convert Supabase BYTEA hex string to Buffer. */
function hexToBuffer(hex: string): Buffer {
  const clean = typeof hex === 'string' && hex.startsWith('\\x') ? hex.slice(2) : hex;
  return Buffer.from(clean, 'hex');
}
