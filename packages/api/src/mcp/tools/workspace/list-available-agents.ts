import { z } from 'zod';
import type { EmployedAgentSummary } from '../../../host.ts';
import { textResult, type McpToolHandler } from '../../types.ts';
import { isResolveError, resolveWorkspace, workspaceOverrideSchema } from '../../workspace.ts';

export const listAvailableAgents: McpToolHandler = {
  name: 'list_available_agents',
  description:
    'List agents that are currently employed (active) in this workspace. Use this to check which agents are available before assigning tasks or delegating work.',
  schema: z.object({ ...workspaceOverrideSchema }),
  scope: 'read',
  group: 'workspace',
  async execute(params, ctx) {
    const resolved = await resolveWorkspace(params, ctx);
    if (isResolveError(resolved)) return resolved;
    // Without a host roster, every agent with a status row counts as employed.
    const agents: EmployedAgentSummary[] = ctx.host.agents?.listEmployed
      ? await ctx.host.agents.listEmployed(resolved.workspaceId)
      : (await ctx.services.agents.listStatus(resolved.scope)).map((s) => ({
          agent_id: s.agent_name,
          display_name: s.agent_name,
          role: null,
          agent_type: null,
        }));
    return textResult(
      JSON.stringify({
        workspace_id: resolved.workspaceId,
        employed_agents: agents.map((a) => ({
          agent_id: a.agent_id,
          display_name: a.display_name,
          role: a.role,
          agent_type: a.agent_type,
        })),
        count: agents.length,
      }),
    );
  },
};
