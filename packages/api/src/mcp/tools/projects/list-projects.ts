import { z } from 'zod';
import { jsonResult, type McpToolHandler } from '../../types.ts';
import {
  failure,
  isResolveError,
  resolveWorkspace,
  workspaceOverrideSchema,
} from '../../workspace.ts';

export const listProjects: McpToolHandler = {
  name: 'list_projects',
  description: 'List projects in the current workspace',
  schema: z.object({
    ...workspaceOverrideSchema,
    group_id: z.string().optional().describe('Filter by project group ID'),
  }),
  scope: 'read',
  group: 'projects',
  async execute(params, ctx) {
    const resolved = await resolveWorkspace(params, ctx);
    if (isResolveError(resolved)) return resolved;
    try {
      const groupId = params.group_id as string | undefined;
      const rows = await ctx.services.projects.list(resolved.scope);
      return jsonResult(
        rows
          .filter((p) => !groupId || p.group_id === groupId)
          .map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            project_type: p.project_type,
            group_id: p.group_id,
            created_at: p.created_at,
          })),
      );
    } catch (error) {
      return failure('Error', error);
    }
  },
};
