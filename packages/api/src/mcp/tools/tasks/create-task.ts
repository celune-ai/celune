import { isLifecycleStatus } from '@celuneai/core';
import type { Task } from '@repo/types';
import { z } from 'zod';
import { errorResult, textResult, type McpToolHandler } from '../../types.ts';
import {
  failure,
  isResolveError,
  resolveWorkspace,
  workspaceOverrideSchema,
} from '../../workspace.ts';

export const createTask: McpToolHandler = {
  name: 'create_task',
  description: 'Create a new task',
  schema: z.object({
    ...workspaceOverrideSchema,
    title: z.string().describe('Task title'),
    description: z.string().optional().describe('Task description'),
    status: z.string().optional().describe('Status (default: inbox)'),
    priority: z.string().optional().describe('Priority: urgent, high, normal, low'),
    project_id: z.string().optional().describe('Project ID to assign to'),
    assignee: z
      .string()
      .optional()
      .describe('Agent ID to assign (must be employed in this workspace)'),
  }),
  scope: 'write',
  group: 'tasks',
  async execute(params, ctx) {
    const resolved = await resolveWorkspace(params, ctx);
    if (isResolveError(resolved)) return resolved;

    const assignee = params.assignee as string | undefined;
    if (assignee && ctx.host.agents?.isEmployed) {
      const employed = await ctx.host.agents.isEmployed(resolved.workspaceId, assignee);
      if (!employed) {
        return errorResult(
          `Agent "${assignee}" is not employed in this workspace. Use list_available_agents to see who's available.`,
        );
      }
    }
    const status = params.status as string | undefined;
    if (status !== undefined && !isLifecycleStatus(status)) {
      return errorResult(`Failed to create task: unknown status "${status}"`);
    }
    try {
      const task = await ctx.services.tasks.create(
        resolved.scope,
        {
          title: params.title as string,
          description: (params.description as string) ?? '',
          status: status ?? 'inbox',
          priority: ((params.priority as string) ?? 'normal') as Task['priority'],
          project_id: (params.project_id as string) ?? null,
          assignee: (assignee ?? 'unassigned') as Task['assignee'],
          user_id: ctx.auth.userId,
          source: 'mcp',
        },
        { source: 'mcp', userId: ctx.auth.userId },
      );
      return textResult(
        `Created task: ${task.title} (${task.id})${task.assignee ? ` → ${task.assignee}` : ''}`,
      );
    } catch (error) {
      return failure('Failed to create task', error);
    }
  },
};
