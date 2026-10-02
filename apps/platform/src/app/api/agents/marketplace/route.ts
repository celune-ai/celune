import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import {
  getAllMarketplaceAgents,
  getAgentCategories,
  type MarketplaceAgent,
} from '@repo/db/team-templates';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { applyRateLimit, RATE_READ, RATE_WRITE } from '@/lib/rate-limiter';
import { validateOrigin } from '@/lib/csrf';
import { resolveWorkspacePlan } from '@/lib/plan-enforcement';
import { maxActiveAgentsForPlan } from '@/lib/agent-seed';
import { isValidUuid } from '@repo/db/validation';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export interface MarketplaceAgentWithStatus extends MarketplaceAgent {
  employed: boolean;
  is_active: boolean;
}

/**
 * GET /api/agents/marketplace
 *
 * Returns all available agents with employment status for the workspace.
 */
export async function GET(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'agents.marketplace.get', RATE_READ);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }

    const permResult = await requirePermission(request, workspaceId, 'tasks:read');
    if (permResult instanceof NextResponse) return permResult;

    const supabase = createServiceClient();

    // Get all agents from template library
    const allAgents = getAllMarketplaceAgents();

    // Get workspace's employed agents
    const { data: employed } = await supabase
      .from('agent_configs')
      .select('agent_id, is_active')
      .eq('workspace_id', workspaceId);

    const employedMap = new Map(
      (employed ?? []).map((e: { agent_id: string; is_active: boolean }) => [
        e.agent_id,
        e.is_active,
      ]),
    );

    // Merge employment status
    const agentsWithStatus: MarketplaceAgentWithStatus[] = allAgents.map((agent) => ({
      ...agent,
      employed: employedMap.has(agent.agent_id),
      is_active: employedMap.get(agent.agent_id) ?? false,
    }));

    // Get plan limits
    const resolved = await resolveWorkspacePlan(workspaceId, permResult.userId);
    const maxAgents = maxActiveAgentsForPlan(
      resolved.isPlatformOwner ? 'platform_owner' : resolved.plan,
    );
    const activeCount = (employed ?? []).filter((e: { is_active: boolean }) => e.is_active).length;

    const categories = getAgentCategories();

    return NextResponse.json({
      agents: agentsWithStatus,
      categories,
      limits: { max: maxAgents, current: activeCount },
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

const employSchema = z.object({
  workspace_id: z.string().uuid(),
  agent_id: z.string().min(1).max(20),
});

/**
 * POST /api/agents/marketplace
 *
 * Employ an agent from the marketplace into the workspace.
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'agents.marketplace.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const parsed = await parseBody(request, employSchema);
    if (isErrorResponse(parsed)) return parsed;

    const { workspace_id: workspaceId, agent_id: agentId } = parsed;

    const permResult = await requirePermission(request, workspaceId, 'tasks:update');
    if (permResult instanceof NextResponse) return permResult;

    const supabase = createServiceClient();

    // Check if already employed
    const { data: existing } = await supabase
      .from('agent_configs')
      .select('agent_id')
      .eq('workspace_id', workspaceId)
      .eq('agent_id', agentId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'Agent already employed' }, { status: 409 });
    }

    // Check plan limits
    const resolved = await resolveWorkspacePlan(workspaceId, permResult.userId);
    const maxAgents = maxActiveAgentsForPlan(
      resolved.isPlatformOwner ? 'platform_owner' : resolved.plan,
    );
    const { count: activeCount } = await supabase
      .from('agent_configs')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);

    if ((activeCount ?? 0) >= maxAgents) {
      return NextResponse.json(
        { error: 'plan_limit', message: `Agent limit reached (${activeCount}/${maxAgents})` },
        { status: 403 },
      );
    }

    // Find the agent in the marketplace catalog
    const allAgents = getAllMarketplaceAgents();
    const template = allAgents.find((a) => a.agent_id === agentId);

    if (!template) {
      return NextResponse.json({ error: 'Agent not found in marketplace' }, { status: 404 });
    }

    // Insert agent config
    const { data: created, error } = await supabase
      .from('agent_configs')
      .insert({
        workspace_id: workspaceId,
        agent_id: template.agent_id,
        display_name: template.display_name,
        role: template.role,
        description: template.description,
        agent_type: 'ai',
        model: template.model,
        color: template.color,
        persona_prompt: template.persona_prompt,
        parameters: template.parameters,
        permissions: template.permissions,
        user_id: permResult.userId,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      return safeErrorResponse(error);
    }

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
