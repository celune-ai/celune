import { z } from 'zod';
import { isEmbedToken } from '../../../auth/types.ts';
import { textResult, type McpToolHandler } from '../../types.ts';
import {
  failure,
  isResolveError,
  resolveWorkspace,
  workspaceOverrideSchema,
} from '../../workspace.ts';

export const claimTask: McpToolHandler = {
  name: 'claim_task',
  description: 'Claim a task and set it to in_progress',
  schema: z.object({
    ...workspaceOverrideSchema,
    task_id: z.string().describe('Task UUID'),
  }),
  scope: 'write',
  group: 'tasks',
  async execute(params, ctx) {
    const resolved = await resolveWorkspace(params, ctx);
    if (isResolveError(resolved)) return resolved;
    try {
      const { task } = await ctx.services.harness.claim(
        resolved.scope,
        params.task_id as string,
        ctx.auth.userId,
        { source: 'mcp', userId: ctx.auth.userId, agentId: ctx.auth.userId },
        { allowRunStart: !isEmbedToken(ctx.auth) },
      );
      return textResult(`Claimed: ${task.title}`);
    } catch (error) {
      return failure('Failed to claim task', error);
    }
  },
};
