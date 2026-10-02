import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { getAuthUserId } from '@/lib/auth';
import { z } from 'zod';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import { requireOrgStaff } from '../../require-org-staff';

export const dynamic = 'force-dynamic';

const updateSharedAgentSchema = z
  .object({
    display_name: z.string().min(1).max(100).optional(),
    role: z.string().max(100).optional(),
    description: z.string().max(2000).optional(),
    model: z.string().max(100).optional(),
    color: z.string().max(20).optional(),
    persona_prompt: z.string().max(5000).optional(),
    capabilities: z.array(z.string()).optional(),
    parameters: z.record(z.string(), z.number()).optional(),
  })
  .strip();

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PUT /api/org/agents/shared/[id]
 * Update a shared agent config.
 */
type UpdateBody = z.infer<typeof updateSharedAgentSchema>;

export const PUT = withApiSecurity<UpdateBody>(
  async (request: NextRequest, { userId, body }: SecurityContext<UpdateBody>) => {
    const orgId = await requireOrgStaff(userId);
    if (!orgId) {
      return NextResponse.json(
        { error: 'Only org owners/admins can manage shared agents' },
        { status: 403 },
      );
    }

    // Extract the [id] param from the URL
    const url = new URL(request.url);
    const segments = url.pathname.split('/');
    const agentRowId = segments[segments.length - 1];

    if (!agentRowId) {
      return NextResponse.json({ error: 'Missing agent ID' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const updates: Record<string, unknown> = {};
    if (body.display_name !== undefined) updates.display_name = body.display_name;
    if (body.role !== undefined) updates.role = body.role;
    if (body.description !== undefined) updates.description = body.description;
    if (body.model !== undefined) updates.model = body.model;
    if (body.color !== undefined) updates.color = body.color;
    if (body.persona_prompt !== undefined) updates.persona_prompt = body.persona_prompt;
    if (body.capabilities !== undefined) updates.capabilities = body.capabilities;
    if (body.parameters !== undefined) updates.parameters = body.parameters;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('org_shared_agents')
      .update(updates)
      .eq('id', agentRowId)
      .eq('org_id', orgId)
      .select()
      .single();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: 'Shared agent not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  },
  {
    rateLimit: { tier: RATE_WRITE, routeKey: 'org.agents.shared.put' },
    parseBody: updateSharedAgentSchema,
  },
);

/**
 * DELETE /api/org/agents/shared/[id]
 * Remove an agent from the org's shared roster.
 */
export async function DELETE(request: NextRequest, _context: RouteContext) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const orgId = await requireOrgStaff(userId);
    if (!orgId) {
      return NextResponse.json(
        { error: 'Only org owners/admins can manage shared agents' },
        { status: 403 },
      );
    }

    const url = new URL(request.url);
    const segments = url.pathname.split('/');
    const agentRowId = segments[segments.length - 1];

    if (!agentRowId) {
      return NextResponse.json({ error: 'Missing agent ID' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { error } = await supabase
      .from('org_shared_agents')
      .delete()
      .eq('id', agentRowId)
      .eq('org_id', orgId);

    if (error) throw error;

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
