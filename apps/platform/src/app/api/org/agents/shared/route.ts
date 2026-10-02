import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { getAuthUserId } from '@/lib/auth';
import { z } from 'zod';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import { requireOrgStaff } from '../require-org-staff';

export const dynamic = 'force-dynamic';

const createSharedAgentSchema = z
  .object({
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
  })
  .strip();

/**
 * GET /api/org/agents/shared
 * List all shared agents for the user's org.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const supabase = createServiceClient();

    // Get user's org (any member can read)
    const { data: membership } = await supabase
      .from('org_memberships')
      .select('org_id')
      .eq('user_id', userId)
      .limit(1)
      .single();

    if (!membership?.org_id) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const { data, error } = await supabase
      .from('org_shared_agents')
      .select(
        'id, org_id, agent_id, display_name, role, description, agent_type, model, color, persona_prompt, capabilities, parameters, created_by, created_at, updated_at',
      )
      .eq('org_id', membership.org_id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * POST /api/org/agents/shared
 * Add an agent to the org's shared roster.
 * Requires org owner/admin.
 */
type CreateSharedAgentBody = z.infer<typeof createSharedAgentSchema>;

export const POST = withApiSecurity<CreateSharedAgentBody>(
  async (_request: NextRequest, { userId, body }: SecurityContext<CreateSharedAgentBody>) => {
    const orgId = await requireOrgStaff(userId);
    if (!orgId) {
      return NextResponse.json(
        { error: 'Only org owners/admins can manage shared agents' },
        { status: 403 },
      );
    }

    const supabase = createServiceClient();

    // Check for duplicate agent_id in this org
    const { data: existing } = await supabase
      .from('org_shared_agents')
      .select('id')
      .eq('org_id', orgId)
      .eq('agent_id', body.agent_id)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: 'Agent ID already exists in org shared roster' },
        { status: 409 },
      );
    }

    const { data, error } = await supabase
      .from('org_shared_agents')
      .insert({
        org_id: orgId,
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
        created_by: userId,
      })
      .select(
        'id, org_id, agent_id, display_name, role, description, agent_type, model, color, persona_prompt, capabilities, parameters, created_by, created_at, updated_at',
      )
      .single();

    if (error) throw error;

    return NextResponse.json(data, { status: 201 });
  },
  {
    rateLimit: { tier: RATE_WRITE, routeKey: 'org.agents.shared.post' },
    parseBody: createSharedAgentSchema,
  },
);
