import { z } from 'zod';
import { submitJobResult as submit, type SubmitJobInput } from '../../../jobs/index.ts';
import { errorResult, textResult, type McpToolHandler } from '../../types.ts';
import {
  failure,
  isResolveError,
  resolveWorkspace,
  workspaceOverrideSchema,
} from '../../workspace.ts';

export const submitJobResult: McpToolHandler = {
  name: 'submit_job_result',
  description: 'Submit the result of a completed AI job. Must include the job_hmac and nonce.',
  schema: z
    .object({
      ...workspaceOverrideSchema,
      job_id: z.string().describe('Job UUID'),
      status: z.enum(['completed', 'failed']).describe('Result status'),
      job_hmac: z.string().describe('Echo back the HMAC from claim_job'),
      nonce: z.string().describe('Echo back the nonce from claim_job'),
      result: z
        .object({
          content: z.string(),
          tool_calls: z.array(z.unknown()).optional(),
          usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
          model: z.string().optional(),
          finish_reason: z.string().optional(),
        })
        .optional()
        .describe('Result payload (required if status=completed)'),
      error: z
        .object({ code: z.string(), message: z.string(), retryable: z.boolean() })
        .optional()
        .describe('Error details (required if status=failed)'),
    })
    .refine((d) => d.status !== 'completed' || d.result !== undefined, {
      message: 'result is required when status is completed',
      path: ['result'],
    })
    .refine((d) => d.status !== 'failed' || d.error !== undefined, {
      message: 'error is required when status is failed',
      path: ['error'],
    }),
  scope: 'write',
  group: 'jobs',
  async execute(params, ctx) {
    const resolved = await resolveWorkspace(params, ctx);
    if (isResolveError(resolved)) return resolved;
    try {
      const outcome = await submit({ ...ctx, scope: resolved.scope }, params.job_id as string, {
        status: params.status as SubmitJobInput['status'],
        job_hmac: params.job_hmac as string,
        nonce: params.nonce as string,
        result: params.result as Record<string, unknown> | undefined,
        error: params.error as SubmitJobInput['error'],
      });
      if (!outcome.ok) return errorResult(outcome.error);
      return textResult(JSON.stringify(outcome.body));
    } catch (error) {
      return failure('Failed to submit result', error);
    }
  },
};
