/**
 * Agent Worker: Claude Messages API tool-use loop for server runs.
 *
 * Claims one agent_run job through JobService, assembles context, loops over
 * the Messages API executing tools, heartbeats each step, and submits the
 * result through the same JobService path polling agents use.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createServiceClient } from '@repo/db/service';
import type { JobRow, Services, WorkspaceScope } from '@celuneai/core';
import {
  resolveProviderKey,
  ProviderKeyRequiredError,
  type KeySource,
} from '@/lib/resolve-provider-key';
import { AiBudgetExceededError } from '@/lib/ai-budget';
import { trackTrialUsage } from '@/lib/track-usage';
import { getOrgIdForUser } from '@/lib/auth';
import { encryptPayload } from '@/lib/ai-job-queue/crypto';
import { getCoreServices, workspaceScope } from '@/lib/core';
import { assembleExecutionContext } from './context-assembler';
import { AGENT_TOOL_DEFINITIONS, executeAgentTool } from './agent-tools';
import { createExecutionEmitter } from './realtime-emitter';
import { SERVER_RUN_MODEL } from './queue-manager';

const MAX_TOOL_LOOPS = 25; // Safety limit on tool-use iterations
const NON_RETRYABLE = new Set(['cancelled', 'budget_exceeded', 'no_api_key', 'timeout']);

export interface WorkerResult {
  success: boolean;
  outcome?: string;
  error?: string;
  tokensUsed: number;
  steps: number;
}

export interface RunServerJobInput {
  jobId: string;
  workspaceId: string;
  workerId?: string;
  services?: Services;
}

export function defaultWorkerId(): string {
  return `server:${process.env.HOSTNAME ?? 'local'}:${process.pid}`;
}

/**
 * Claim and process one server run. Returns without running when the job
 * is not pending or another worker won the claim.
 */
export async function runServerJob(input: RunServerJobInput): Promise<WorkerResult> {
  const services = input.services ?? getCoreServices(createServiceClient());
  const workerId = input.workerId ?? defaultWorkerId();
  const claimant = { workerId };
  const jobs = services.jobs;

  const probe = await jobs.get(
    workspaceScope({ workspaceId: input.workspaceId }),
    input.jobId,
    'id, org_id, runner, status',
  );
  if (!probe || probe.runner !== 'server') {
    return { success: false, error: 'Execution not found', tokensUsed: 0, steps: 0 };
  }
  const scope = workspaceScope({
    workspaceId: input.workspaceId,
    orgId: (probe.org_id as string | null) ?? null,
    actorId: workerId,
  });

  const claim = await jobs.claim(scope, input.jobId, claimant);
  if (!claim.claimed) {
    return { success: false, error: claim.reason, tokensUsed: 0, steps: 0 };
  }
  const job = claim.job;
  const metadata = asRecord(job.metadata);
  const context = asRecord(metadata.context);
  const agentId = typeof metadata.agent_id === 'string' ? metadata.agent_id : 'rick';
  const taskId = job.target_type === 'task' ? String(job.target_id) : null;
  const requesterId = String(job.requester_id ?? '');
  const tokenBudget = Number(job.token_budget ?? 0) || Number.MAX_SAFE_INTEGER;
  const timeoutMs = Number(job.start_to_close_ms ?? 0);
  const claimedAt = Date.now();

  const emitter = taskId ? createExecutionEmitter(taskId) : null;
  let totalTokens = 0;
  let stepIndex = 0;

  const log = (entry: {
    eventType: string;
    content?: string;
    toolName?: string;
    toolInput?: unknown;
    inputTokens?: number;
    outputTokens?: number;
  }) =>
    jobs.appendLog(scope, {
      job_id: job.id,
      step_index: stepIndex++,
      event_type: entry.eventType,
      content: entry.content ?? null,
      tool_name: entry.toolName ?? null,
      tool_input: entry.toolInput ?? null,
      input_tokens: entry.inputTokens ?? 0,
      output_tokens: entry.outputTokens ?? 0,
    });

  const fail = async (code: string, message: string): Promise<WorkerResult> => {
    const owned = await jobs.getOwned(scope, job.id, claimant);
    if (owned.ok) {
      await jobs.submitResult(scope, owned.job, {
        status: 'failed',
        error: { code, message, retryable: !NON_RETRYABLE.has(code) },
        extra: { tokens_used: totalTokens },
      });
    }
    await emitter?.emit({ type: 'failed', error: message, code });
    await emitter?.close();
    await log({ eventType: 'error', content: message });
    return { success: false, error: message, tokensUsed: totalTokens, steps: stepIndex };
  };

  try {
    await log({ eventType: 'status_change', content: 'Execution started' });

    // Resolve API key through the BYOK chain; there is no direct env fallback.
    let anthropicApiKey: string;
    let keySource: KeySource = 'platform';
    try {
      const orgId = requesterId ? await getOrgIdForUser(requesterId) : null;
      if (!orgId) throw new ProviderKeyRequiredError('anthropic', false);
      const resolved = await resolveProviderKey('anthropic', orgId, input.workspaceId, {
        userId: requesterId,
      });
      anthropicApiKey = resolved.key;
      keySource = resolved.source;
    } catch (err) {
      if (err instanceof ProviderKeyRequiredError) {
        return fail('no_api_key', 'No API key available for execution');
      }
      if (err instanceof AiBudgetExceededError) {
        return fail('budget_exceeded', err.message);
      }
      throw err;
    }

    if (!taskId) {
      return fail('unsupported_target', 'Server runs currently need a task target');
    }

    // Assemble context
    const assembled = await assembleExecutionContext({
      workspaceId: input.workspaceId,
      taskId,
      agentId,
      projectId: typeof context.project_id === 'string' ? context.project_id : undefined,
    });

    await log({
      eventType: 'status_change',
      content: 'Context assembled, starting Claude API loop',
    });

    const modelPref = assembled.metadata.model_preferences as Record<string, unknown> | null;
    const model = (modelPref?.default as string) ?? SERVER_RUN_MODEL;
    await emitter?.emit({ type: 'started', agent_id: agentId, model });

    const client = new Anthropic({ apiKey: anthropicApiKey });
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: assembled.userMessage }];

    let loopCount = 0;
    let finalOutcome = '';

    while (loopCount < MAX_TOOL_LOOPS) {
      loopCount++;

      // The heartbeat doubles as the cancel check
      const beat = await jobs.heartbeat(scope, job.id, claimant, { tokens_so_far: totalTokens });
      if (!beat.continue) {
        await emitter?.emit({ type: 'failed', error: 'Execution cancelled', code: 'cancelled' });
        await emitter?.close();
        await log({ eventType: 'status_change', content: 'Execution cancelled' });
        return {
          success: false,
          error: 'Execution cancelled',
          tokensUsed: totalTokens,
          steps: stepIndex,
        };
      }

      if (timeoutMs > 0 && Date.now() - claimedAt > timeoutMs) {
        return fail(
          'timeout',
          `Execution timed out after ${Math.round((Date.now() - claimedAt) / 1000)}s (limit: ${Math.round(timeoutMs / 1000)}s)`,
        );
      }

      if (totalTokens >= tokenBudget) {
        return fail('budget_exceeded', `Token budget exceeded: ${totalTokens}/${tokenBudget}`);
      }

      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: assembled.systemPrompt,
        tools: AGENT_TOOL_DEFINITIONS,
        messages,
      });

      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      totalTokens += inputTokens + outputTokens;

      const assistantContent: Anthropic.ContentBlock[] = response.content;

      for (const block of assistantContent) {
        if (block.type === 'text') {
          await log({ eventType: 'message', content: block.text, inputTokens, outputTokens });
          finalOutcome = block.text;
          await emitter?.emit({ type: 'message', content: block.text });
        }
      }

      await emitter?.emit({
        type: 'progress',
        step: loopCount,
        tokens_used: totalTokens,
        elapsed_ms: Date.now() - new Date(String(job.created_at)).getTime(),
      });

      if (response.stop_reason === 'end_turn') break;

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: assistantContent });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        let shouldStop = false;

        for (const block of assistantContent) {
          if (block.type !== 'tool_use') continue;

          await log({
            eventType: 'tool_call',
            toolName: block.name,
            toolInput: block.input as Record<string, unknown>,
          });
          await emitter?.emit({
            type: 'tool_call',
            tool_name: block.name,
            tool_input: block.input,
          });

          const { result, shouldStop: stop } = await executeAgentTool(
            block.name,
            block.input as Record<string, unknown>,
            { workspaceId: input.workspaceId, agentId, executionId: job.id },
          );

          await log({
            eventType: 'tool_result',
            toolName: block.name,
            content: result.slice(0, 2000),
          });
          await emitter?.emit({
            type: 'tool_result',
            tool_name: block.name,
            result: result.slice(0, 500),
          });

          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
          if (stop) shouldStop = true;
        }

        messages.push({ role: 'user', content: toolResults });

        if (shouldStop) {
          finalOutcome = 'Execution stopped: agent reported a blocker.';
          break;
        }
        continue;
      }

      break;
    }

    if (loopCount >= MAX_TOOL_LOOPS) {
      finalOutcome = `Execution reached max iterations (${MAX_TOOL_LOOPS}). Last output: ${finalOutcome.slice(0, 500)}`;
    }

    trackTrialUsage(input.workspaceId, totalTokens, keySource);
    await completeRun(services, scope, job, claimant, finalOutcome, totalTokens);
    await emitter?.emit({
      type: 'completed',
      outcome: finalOutcome.slice(0, 500),
      tokens_used: totalTokens,
      steps: stepIndex,
    });
    await emitter?.close();
    await log({
      eventType: 'status_change',
      content: `Execution completed. ${loopCount} API calls, ${totalTokens} tokens used.`,
    });

    return { success: true, outcome: finalOutcome, tokensUsed: totalTokens, steps: stepIndex };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail('worker_error', message);
  }
}

async function completeRun(
  services: Services,
  scope: WorkspaceScope,
  job: JobRow,
  claimant: { workerId: string },
  outcome: string,
  tokensUsed: number,
): Promise<void> {
  const owned = await services.jobs.getOwned(scope, job.id, claimant);
  if (!owned.ok) return;
  const { encrypted, iv } = encryptPayload(JSON.stringify({ content: outcome }));
  await services.jobs.submitResult(scope, owned.job, {
    status: 'completed',
    result: {
      result_encrypted: '\\x' + encrypted.toString('hex'),
      result_iv: '\\x' + iv.toString('hex'),
    },
    extra: { tokens_used: tokensUsed },
  });

  if (tokensUsed > 0) {
    const supabase = createServiceClient();
    const { error } = await supabase.from('usage_events').insert({
      workspace_id: scope.workspaceId,
      user_id: job.requester_id,
      event_type: 'execution',
      quantity: tokensUsed,
      metadata: {
        execution_id: job.id,
        agent_id: asRecord(job.metadata).agent_id,
        task_id: job.target_type === 'task' ? job.target_id : null,
        target_type: job.target_type,
      },
    });
    if (error) console.error('[execution] usage_event insert failed:', error.message);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
