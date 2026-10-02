import { z } from 'zod';
import { textResult, type McpToolHandler } from '../../types.ts';
import {
  failure,
  isResolveError,
  resolveWorkspace,
  workspaceOverrideSchema,
} from '../../workspace.ts';

export const completeTask: McpToolHandler = {
  name: 'complete_task',
  description:
    'Mark a task as done with an optional outcome. The outcome is automatically stored to memory.',
  schema: z.object({
    ...workspaceOverrideSchema,
    task_id: z.string().describe('Task UUID'),
    outcome: z.string().optional().describe('What was accomplished'),
  }),
  scope: 'write',
  group: 'tasks',
  async execute(params, ctx) {
    const resolved = await resolveWorkspace(params, ctx);
    if (isResolveError(resolved)) return resolved;
    try {
      const task = await ctx.services.tasks.complete(
        resolved.scope,
        params.task_id as string,
        { outcome: (params.outcome as string) ?? null },
        { source: 'mcp', userId: ctx.auth.userId },
      );
      return textResult(`Completed: ${task.title}`);
    } catch (error) {
      return failure('Failed to complete task', error);
    }
  },
};
