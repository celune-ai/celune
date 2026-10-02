import { isCoreError } from '@celuneai/core';
import { z } from 'zod';
import { errorResult, textResult, type McpToolHandler } from '../../types.ts';
import {
  failure,
  isResolveError,
  resolveWorkspace,
  workspaceOverrideSchema,
} from '../../workspace.ts';

export const addComment: McpToolHandler = {
  name: 'add_comment',
  description: 'Add a comment to a task',
  schema: z.object({
    ...workspaceOverrideSchema,
    task_id: z.string().describe('Task UUID'),
    content: z.string().describe('Comment text'),
  }),
  scope: 'write',
  group: 'tasks',
  async execute(params, ctx) {
    const resolved = await resolveWorkspace(params, ctx);
    if (isResolveError(resolved)) return resolved;
    try {
      await ctx.services.tasks.addComment(
        resolved.scope,
        params.task_id as string,
        { author: ctx.auth.userId, content: params.content as string, userId: ctx.auth.userId },
        { source: 'mcp', userId: ctx.auth.userId },
      );
      return textResult('Comment added.');
    } catch (error) {
      if (isCoreError(error) && error.code === 'not_found') {
        return errorResult('Error: Task not found in this workspace');
      }
      return failure('Failed to add comment', error);
    }
  },
};
