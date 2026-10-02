import { z } from 'zod';
import { redactJob } from '../../../jobs/index.ts';
import { textResult, type McpToolHandler } from '../../types.ts';
import {
  failure,
  isResolveError,
  resolveWorkspace,
  workspaceOverrideSchema,
} from '../../workspace.ts';

export const pollPendingJobs: McpToolHandler = {
  name: 'poll_pending_jobs',
  description:
    'Check for pending AI jobs in your workspace queue. Call this periodically to pick up work.',
  schema: z.object({
    ...workspaceOverrideSchema,
    queue_name: z.string().optional().describe('Queue name filter (default: "default")'),
    job_types: z
      .array(z.enum(['chat', 'completion', 'embedding', 'structured_output']))
      .optional()
      .describe('Filter by supported job types'),
    limit: z.number().optional().describe('Max jobs to return (default 5)'),
  }),
  scope: 'read',
  group: 'jobs',
  async execute(params, ctx) {
    const resolved = await resolveWorkspace(params, ctx);
    if (isResolveError(resolved)) return resolved;
    try {
      const result = await ctx.services.jobs.poll(resolved.scope, {
        queueName: (params.queue_name as string) ?? 'default',
        jobTypes: params.job_types as string[] | undefined,
        limit: (params.limit as number) ?? 5,
      });
      return textResult(
        JSON.stringify({ jobs: result.jobs.map(redactJob), queue_depth: result.queue_depth }),
      );
    } catch (error) {
      return failure('Failed to poll jobs', error);
    }
  },
};
