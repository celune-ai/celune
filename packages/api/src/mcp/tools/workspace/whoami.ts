import { z } from 'zod';
import { jsonResult, type McpToolHandler } from '../../types.ts';

export const whoami: McpToolHandler = {
  name: 'whoami',
  description:
    'Call this tool first. Returns your identity, workspace context, scopes, and the workspaces this credential can reach.',
  schema: z.object({}),
  scope: 'public',
  group: 'workspace',
  async execute(_params, ctx) {
    const { auth } = ctx;
    const workspace = await ctx.host.describeWorkspace?.(auth, auth.workspaceId);
    return jsonResult({
      user_id: auth.userId,
      principal: auth.principal,
      workspace: workspace?.name ?? 'unknown',
      workspace_slug: workspace?.slug ?? 'unknown',
      workspace_id: auth.workspaceId,
      org_id: auth.orgId,
      scopes: auth.scopes,
      environment: auth.environment,
      realtime_enabled: auth.realtimeEnabled,
      available_workspaces: [
        {
          id: auth.workspaceId,
          name: workspace?.name ?? null,
          slug: workspace?.slug ?? null,
          is_current: true,
        },
      ],
    });
  },
};
