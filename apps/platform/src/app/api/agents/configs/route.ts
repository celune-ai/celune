import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { z } from 'zod';
import { enforcePlanLimit } from '@/lib/plan-enforcement';
import { extractRequiredWorkspaceId } from '@/lib/require-workspace';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';

export const dynamic = 'force-dynamic';

/** Default permissions for new AI agents — enables chat, memory, and task access. */
const DEFAULT_AI_PERMISSIONS = [
  'read_vault',
  'write_vault',
  'create_tasks',
  'update_tasks',
  'read_memory',
  'write_memory',
  'call_claude',
];

const createAgentConfigSchema = z
  .object({
    workspace_id: z.string().uuid(),
    agent_id: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[a-z0-9_-]+$/),
    display_name: z.string().min(1).max(100),
    role: z.string().max(100).optional(),
    description: z.string().max(2000).optional(),
    agent_type: z.enum(['ai', 'human']).default('ai'),
    model: z.string().max(100).optional(),
    color: z.string().max(20).optional(),
    persona_prompt: z.string().max(5000).optional(),
    capabilities: z.array(z.string()).optional(),
    parameters: z.record(z.string(), z.number()).optional(),
    permissions: z.array(z.string()).optional(),
  })
  .strip();

/**
 * GET /api/agents/configs?workspace_id=xxx
 * List all agent configs for a workspace.
 * When org sharing is enabled, merges inherited org agents (marked is_shared/is_readonly).
 */
export async function GET(request: NextRequest) {
  try {
    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    const permResult = await requirePermission(request, workspaceId, 'agents:read');
    if (permResult instanceof NextResponse) return permResult;

    const supabase = createServiceClient();

    // Resolve workspace org_id first
    const { data: workspace, error: wsError } = await supabase
      .from('workspaces')
      .select('org_id')
      .eq('id', workspaceId)
      .single();

    if (wsError) throw wsError;

    // V1: show all org-wide agents across all workspaces in the org
    // Fetch all workspace IDs in this org, then get agents from all of them
    const { data: orgWorkspaces } = await supabase
      .from('workspaces')
      .select('id')
      .eq('org_id', workspace?.org_id);

    const orgWorkspaceIds = (orgWorkspaces ?? []).map((w) => w.id);

    if (orgWorkspaceIds.length === 0) {
      // Fallback: at least include the current workspace
      orgWorkspaceIds.push(workspaceId);
    }

    // Fetch ALL agent configs across the org
    const { data: allConfigs, error: agentsError } = await supabase
      .from('agent_configs')
      .select(
        'workspace_id, agent_id, display_name, role, description, agent_type, model, color, persona_prompt, capabilities, parameters, permissions, user_id, is_active, is_lead, created_at, updated_at',
      )
      .in('workspace_id', orgWorkspaceIds)
      .order('created_at', { ascending: true });

    if (agentsError) throw agentsError;

    // Build shared org-wide config per agent_id (earliest created = source of truth)
    // Then overlay per-workspace is_active from the current workspace's record
    const configByAgent = new Map<string, Record<string, unknown>>();
    const localActiveMap = new Map<string, boolean>();

    for (const row of (allConfigs ?? []) as Record<string, unknown>[]) {
      const agentId = row.agent_id as string;

      // Track current workspace's is_active
      if (row.workspace_id === workspaceId) {
        localActiveMap.set(agentId, row.is_active as boolean);
      }

      // Use earliest config as the source of truth (first insert wins)
      if (!configByAgent.has(agentId)) {
        configByAgent.set(agentId, { ...row });
      }
    }

    // Build final agent list with per-workspace employment status
    const agents = Array.from(configByAgent.values()).map((agent) => {
      const agentId = agent.agent_id as string;
      const isLead =
        agent.is_lead === true || ((agent.role as string) ?? '').toLowerCase().includes('lead');
      const hasLocalRecord = localActiveMap.has(agentId);

      let isActive: boolean;
      if (isLead) {
        // Lead agents are always employed across all workspaces
        isActive = true;
      } else if (hasLocalRecord) {
        // Use the current workspace's is_active value
        isActive = localActiveMap.get(agentId)!;
      } else {
        // No record in this workspace = not employed here
        isActive = false;
      }

      return { ...agent, workspace_id: workspaceId, is_active: isActive };
    });

    // Note: org_shared_agents is superseded by org-wide agent configs.
    // All agents are now shared across org workspaces via the query above.

    return NextResponse.json(agents, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=15' },
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * POST /api/agents/configs
 * Create a new agent config for a workspace.
 */
type CreateAgentConfigBody = z.infer<typeof createAgentConfigSchema>;

export const POST = withApiSecurity<CreateAgentConfigBody>(
  async (_request: NextRequest, { userId, body }: SecurityContext<CreateAgentConfigBody>) => {
    // Enforce agent count limit
    const planBlocked = await enforcePlanLimit(
      { workspaceId: body.workspace_id, userId },
      'agents',
    );
    if (planBlocked) return planBlocked;

    const supabase = createServiceClient();

    // Check if agent_id already exists in this workspace
    const { data: existing } = await supabase
      .from('agent_configs')
      .select('agent_id')
      .eq('workspace_id', body.workspace_id)
      .eq('agent_id', body.agent_id)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: 'Agent ID already exists in this workspace' },
        { status: 409 },
      );
    }

    const { data, error } = await supabase
      .from('agent_configs')
      .insert({
        workspace_id: body.workspace_id,
        agent_id: body.agent_id,
        display_name: body.display_name,
        role: body.role ?? null,
        description: body.description ?? null,
        agent_type: body.agent_type,
        model: body.model ?? null,
        color: body.color ?? null,
        persona_prompt: body.persona_prompt ?? null,
        capabilities: body.capabilities ?? [],
        parameters: body.parameters ?? {},
        permissions: body.permissions ?? (body.agent_type === 'ai' ? DEFAULT_AI_PERMISSIONS : []),
        user_id: userId,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data, { status: 201 });
  },
  {
    permission: 'agents:configure',
    rateLimit: { tier: RATE_WRITE, routeKey: 'agents.configs.post' },
    parseBody: createAgentConfigSchema,
  },
);
