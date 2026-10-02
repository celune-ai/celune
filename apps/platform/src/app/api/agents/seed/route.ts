/**
 * POST /api/agents/seed
 *
 * Provision agents for a workspace from the team template library.
 * Called during onboarding to bootstrap the agent team.
 *
 * Body: { workspace_id: string, useCase?: string }
 * Returns: { agents: AgentConfig[], plan: string, templateId: string, templateName: string }
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { seedDefaultAgents, maxActiveAgentsForPlan } from '@/lib/agent-seed';
import { resolveWorkspacePlan } from '@/lib/plan-enforcement';
import { agentSeedSchema } from '@/lib/schemas/onboarding.schema';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

type AgentSeedBody = z.infer<typeof agentSeedSchema>;

export const POST = withApiSecurity<AgentSeedBody>(
  async (_request: NextRequest, { userId, body }: SecurityContext<AgentSeedBody>) => {
    const { workspace_id, useCase } = body;

    const supabase = createServiceClient();

    // Verify user has access to this workspace
    const { data: membership } = await supabase
      .from('workspace_memberships')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('workspace_id', workspace_id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Check if agents already exist for this workspace
    const { data: existingAgents } = await supabase
      .from('agent_configs')
      .select('agent_id, display_name, role, description, model, color, is_active')
      .eq('workspace_id', workspace_id);

    if (existingAgents && existingAgents.length > 0) {
      // Still need to compute plan for maxActive even when agents exist
      const { plan: existingPlan } = await resolveWorkspacePlan(workspace_id, userId);
      return NextResponse.json(
        {
          agents: existingAgents,
          plan: existingPlan,
          maxActive: maxActiveAgentsForPlan(existingPlan),
          message: 'Agents already provisioned',
        },
        { status: 200 },
      );
    }

    const { plan } = await resolveWorkspacePlan(workspace_id, userId);

    // Seed from team template library
    const validUseCase = useCase ?? undefined;
    const result = await seedDefaultAgents(workspace_id, plan, userId, validUseCase);

    // Fetch ALL seeded agents (active + inactive) to return full details
    const { data: seededAgents } = await supabase
      .from('agent_configs')
      .select('agent_id, display_name, role, description, model, color, is_active')
      .eq('workspace_id', workspace_id);

    return NextResponse.json(
      {
        agents: seededAgents ?? [],
        plan,
        maxActive: maxActiveAgentsForPlan(plan),
        seeded: result.seeded,
        skipped: result.skipped,
        templateId: result.templateId,
        templateName: result.templateName,
      },
      { status: 201 },
    );
  },
  {
    rateLimit: { tier: RATE_WRITE, routeKey: 'agents.seed.post' },
    permission: 'agents:configure',
    parseBody: agentSeedSchema,
  },
);
