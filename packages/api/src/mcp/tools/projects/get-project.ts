import { z } from 'zod';
import { errorResult, jsonResult, type McpToolHandler } from '../../types.ts';
import { isResolveError, resolveWorkspace, workspaceOverrideSchema } from '../../workspace.ts';

export const getProject: McpToolHandler = {
  name: 'get_project',
  description: 'Get a project with its task summary',
  schema: z.object({
    ...workspaceOverrideSchema,
    project_id: z.string().describe('Project UUID'),
  }),
  scope: 'read',
  group: 'projects',
  async execute(params, ctx) {
    const resolved = await resolveWorkspace(params, ctx);
    if (isResolveError(resolved)) return resolved;
    const projectId = params.project_id as string;
    const project = await ctx.services.projects.get(resolved.scope, projectId).catch(() => null);
    if (!project) return errorResult('Error: Operation failed');
    const tasks = await ctx.services.tasks.list(resolved.scope, { projectId });
    return jsonResult({
      ...project,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        assignee: t.assignee,
      })),
    });
  },
};
