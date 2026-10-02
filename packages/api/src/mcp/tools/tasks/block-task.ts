import { z } from 'zod';
import { textResult, type McpToolHandler } from '../../types.ts';
import {
  failure,
  isResolveError,
  resolveWorkspace,
  workspaceOverrideSchema,
} from '../../workspace.ts';

export const blockTask: McpToolHandler = {
  name: 'block_task',
  description: 'Flag a task as blocked with a reason',
  schema: z.object({
    ...workspaceOverrideSchema,
    task_id: z.string().describe('Task UUID'),
    reason: z.string().describe('Why the task is blocked'),
  }),
  scope: 'write',
  group: 'tasks',
  async execute(params, ctx) {
    const resolved = await resolveWorkspace(params, ctx);
    if (isResolveError(resolved)) return resolved;
    try {
      const task = await ctx.services.tasks.block(
        resolved.scope,
        params.task_id as string,
        { reason: params.reason as string },
        { source: 'mcp', userId: ctx.auth.userId },
      );
      return textResult(`Blocked: ${task.title}: ${params.reason}`);
    } catch (error) {
      return failure('Failed to block task', error);
    }
  },
};
