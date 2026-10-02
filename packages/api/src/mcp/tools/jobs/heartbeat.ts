import { z } from 'zod';
import { heartbeatJob, type HeartbeatInput } from '../../../jobs/index.ts';
import { errorResult, textResult, type McpToolHandler } from '../../types.ts';
import {
  failure,
  isResolveError,
  resolveWorkspace,
  workspaceOverrideSchema,
} from '../../workspace.ts';

export const heartbeat: McpToolHandler = {
  name: 'heartbeat',
  description:
    'Send a heartbeat for an in-progress AI job. Call this periodically while executing.',
  schema: z.object({
    ...workspaceOverrideSchema,
    job_id: z.string().describe('Job UUID'),
    progress: z
      .object({
        chunks_received: z.number().optional(),
        tokens_so_far: z.number().optional(),
        partial_result: z.string().optional().describe('Checkpoint for resume-on-retry'),
      })
      .optional(),
  }),
  scope: 'write',
  group: 'jobs',
  async execute(params, ctx) {
    const resolved = await resolveWorkspace(params, ctx);
    if (isResolveError(resolved)) return resolved;
    try {
      const outcome = await heartbeatJob(
        { ...ctx, scope: resolved.scope },
        params.job_id as string,
        params.progress as HeartbeatInput | undefined,
      );
      if (!outcome.ok) return errorResult(outcome.error);
      return textResult(JSON.stringify(outcome.body));
    } catch (error) {
      return failure('Heartbeat failed', error);
    }
  },
};
