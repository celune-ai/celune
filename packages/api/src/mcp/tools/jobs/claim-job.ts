import { z } from 'zod';
import { claimJob as claim } from '../../../jobs/index.ts';
import { errorResult, textResult, type McpToolHandler } from '../../types.ts';
import { isResolveError, resolveWorkspace, workspaceOverrideSchema } from '../../workspace.ts';

export const claimJob: McpToolHandler = {
  name: 'claim_job',
  description:
    'Claim a pending AI job for execution. Returns the full job payload including messages and system prompt.',
  schema: z.object({
    ...workspaceOverrideSchema,
    job_id: z.string().describe('Job UUID to claim'),
  }),
  scope: 'write',
  group: 'jobs',
  async execute(params, ctx) {
    const resolved = await resolveWorkspace(params, ctx);
    if (isResolveError(resolved)) return resolved;
    const outcome = await claim({ ...ctx, scope: resolved.scope }, params.job_id as string);
    if (!outcome.ok) return errorResult(outcome.error);
    return textResult(JSON.stringify(outcome.body));
  },
};
