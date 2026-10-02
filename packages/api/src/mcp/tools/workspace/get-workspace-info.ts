import { z } from 'zod';
import { jsonResult, type McpToolHandler } from '../../types.ts';
import { isResolveError, resolveWorkspace, workspaceOverrideSchema } from '../../workspace.ts';

export const getWorkspaceInfo: McpToolHandler = {
  name: 'get_workspace_info',
  description: 'Get workspace name, slug, and plan information',
  schema: z.object({ ...workspaceOverrideSchema }),
  scope: 'public',
  group: 'workspace',
  async execute(params, ctx) {
    const resolved = await resolveWorkspace(params, ctx);
    if (isResolveError(resolved)) return resolved;
    const workspace = await ctx.host.describeWorkspace?.(ctx.auth, resolved.workspaceId);
    return jsonResult(workspace ?? { id: resolved.workspaceId, name: null, slug: null });
  },
};
