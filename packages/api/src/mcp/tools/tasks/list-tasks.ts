import { isLifecycleStatus } from '@celuneai/core';
import { z } from 'zod';
import { errorResult, jsonResult, type McpToolHandler } from '../../types.ts';
import {
  failure,
  isResolveError,
  resolveWorkspace,
  workspaceOverrideSchema,
} from '../../workspace.ts';

export const listTasks: McpToolHandler = {
  name: 'list_tasks',
  description: 'List tasks in the current workspace',
  schema: z.object({
    ...workspaceOverrideSchema,
    status: z.string().optional().describe('Filter by status (inbox, in_progress, done, etc.)'),
    assignee: z.string().optional().describe('Filter by assignee'),
    project_id: z.string().optional().describe('Filter by project ID'),
    limit: z.number().optional().describe('Max results (default 50)'),
  }),
  scope: 'read',
  group: 'tasks',
  async execute(params, ctx) {
    const resolved = await resolveWorkspace(params, ctx);
    if (isResolveError(resolved)) return resolved;
    const status = params.status as string | undefined;
    if (status !== undefined && !isLifecycleStatus(status)) {
      return errorResult(`Failed to list tasks: unknown status "${status}"`);
    }
    try {
      const rows = await ctx.services.tasks.list(resolved.scope, {
        status,
        assignee: params.assignee as string | undefined,
        projectId: params.project_id as string | undefined,
        limit: (params.limit as number) ?? 50,
      });
      return jsonResult(
        rows.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          assignee: t.assignee,
          project_id: t.project_id,
          created_at: t.created_at,
          updated_at: t.updated_at,
        })),
      );
    } catch (error) {
      return failure('Failed to list tasks', error);
    }
  },
};
