import { z } from 'zod';
import { textResult, type McpToolHandler } from '../../types.ts';
import {
  failure,
  isResolveError,
  resolveWorkspace,
  workspaceOverrideSchema,
} from '../../workspace.ts';

export const createProject: McpToolHandler = {
  name: 'create_project',
  description: 'Create a new project in the current workspace',
  schema: z.object({
    ...workspaceOverrideSchema,
    name: z.string().describe('Project name'),
    description: z.string().optional().describe('Project description (1-2 sentences)'),
    project_type: z
      .enum(['feature', 'system', 'research', 'plan'])
      .optional()
      .describe('Project type (default: feature)'),
  }),
  scope: 'write',
  group: 'projects',
  async execute(params, ctx) {
    const resolved = await resolveWorkspace(params, ctx);
    if (isResolveError(resolved)) return resolved;
    try {
      const project = await ctx.services.projects.create(
        resolved.scope,
        {
          name: params.name as string,
          description: (params.description as string) ?? '',
          project_type: ((params.project_type as string) ?? 'feature') as
            'feature' | 'system' | 'research' | 'plan',
          status: 'active',
          user_id: ctx.auth.userId,
        },
        { source: 'mcp', userId: ctx.auth.userId },
      );
      return textResult(
        `Created project: ${project.name} (${project.id})\nType: ${project.project_type}\nStatus: ${project.status}`,
      );
    } catch (error) {
      return failure('Error', error);
    }
  },
};
