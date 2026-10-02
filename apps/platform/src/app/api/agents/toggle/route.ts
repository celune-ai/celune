/**
 * POST /api/agents/toggle
 *
 * Toggle an agent's is_active status (employ / bench).
 * Enforces the plan tier's max active agent limit.
 *
 * Body: { workspace_id: string, agent_id: string, is_active: boolean }
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { maxActiveAgentsForPlan } from '@/lib/agent-seed';
import { resolveWorkspacePlan } from '@/lib/plan-enforcement';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const toggleSchema = z.object({
  workspace_id: z.string().uuid(),
  agent_id: z.string().min(1),
  is_active: z.boolean(),
});

type ToggleBody = z.infer<typeof toggleSchema>;

export const POST = withApiSecurity<ToggleBody>(
  async (_request: NextRequest, { userId, body }: SecurityContext<ToggleBody>) => {
    const { workspace_id, agent_id, is_active } = body;

    const supabase = createServiceClient();

    // Verify workspace membership
    const { data: membership } = await supabase
      .from('workspace_memberships')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('workspace_id', workspace_id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Check if agent has a record in this workspace
    let { data: agent } = await supabase
      .from('agent_configs')
      .select('agent_id, display_name, is_active, role, is_lead')
      .eq('workspace_id', workspace_id)
      .eq('agent_id', agent_id)
      .maybeSingle();

    // Block toggling off lead agents
    if (agent && !is_active) {
      const isLead =
        (agent as Record<string, unknown>).is_lead === true ||
        ((agent.role ?? '') as string).toLowerCase().includes('lead');
      if (isLead) {
        return NextResponse.json({ error: 'Lead agents cannot be unemployed.' }, { status: 400 });
      }
    }

    // If no record in this workspace, find the source config from another org workspace
    // and create a local record to track employment
    if (!agent) {
      const { data: ws } = await supabase
        .from('workspaces')
        .select('org_id')
        .eq('id', workspace_id)
        .single();

      if (ws?.org_id) {
        const { data: orgWs } = await supabase
          .from('workspaces')
          .select('id')
          .eq('org_id', ws.org_id);

        const { data: sourceAgent } = await supabase
          .from('agent_configs')
          .select('*')
          .in(
            'workspace_id',
            (orgWs ?? []).map((w) => w.id),
          )
          .eq('agent_id', agent_id)
          .order('created_at', { ascending: true })
          .limit(1)
          .single();

        if (sourceAgent) {
          const { workspace_id: _ws, ...rest } = sourceAgent;
          await supabase.from('agent_configs').insert({ ...rest, workspace_id, is_active });

          return NextResponse.json({ agent_id, is_active, created: true });
        }
      }

      return NextResponse.json({ error: 'Agent not found in organization' }, { status: 404 });
    }

    // If activating, check plan limit
    if (is_active) {
      const { plan } = await resolveWorkspacePlan(workspace_id, userId);
      const maxActive = maxActiveAgentsForPlan(plan);

      const { count } = await supabase
        .from('agent_configs')
        .select('agent_id', { count: 'exact', head: true })
        .eq('workspace_id', workspace_id)
        .eq('is_active', true);

      if ((count ?? 0) >= maxActive) {
        return NextResponse.json(
          {
            error: `You can have up to ${maxActive} active agents on your current plan. Deactivate an agent first or upgrade your plan.`,
            limit: maxActive,
            current: count ?? 0,
          },
          { status: 403 },
        );
      }
    } else {
      // Ensure at least 1 agent remains active
      const { count } = await supabase
        .from('agent_configs')
        .select('agent_id', { count: 'exact', head: true })
        .eq('workspace_id', workspace_id)
        .eq('is_active', true);

      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: 'You must have at least one active agent.' },
          { status: 400 },
        );
      }
    }

    // Toggle
    const { error } = await supabase
      .from('agent_configs')
      .update({ is_active })
      .eq('workspace_id', workspace_id)
      .eq('agent_id', agent_id);

    if (error) {
      console.error('Failed to toggle agent:', error.message);
      return NextResponse.json({ error: 'Failed to update agent status.' }, { status: 500 });
    }

    return NextResponse.json({ agent_id, is_active });
  },
  {
    rateLimit: { tier: RATE_WRITE, routeKey: 'agents.toggle.post' },
    permission: 'agents:configure',
    parseBody: toggleSchema,
  },
);
