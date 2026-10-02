import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { createActivity } from '@repo/db/queries';
import { isValidUuid } from '@repo/db/validation';
import { loadAgentConfig } from '@/lib/agent-loader';
import { safeErrorResponse } from '@/lib/api-error';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { agentConfigSchema } from '@/lib/schemas/agents.schema';
import { requirePermission } from '@/lib/permissions';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { getAuthUserId } from '@/lib/auth';
import { validateOrigin } from '@/lib/csrf';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { createServiceClient } from '@repo/db/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }
    if (!isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }

    const membershipError = await requireWorkspaceMembership(userId, workspaceId);
    if (membershipError) return membershipError;

    const agent = await loadAgentConfig(workspaceId, id);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    return NextResponse.json({
      parameters: agent.parameters,
      active_profile: agent.activeProfile,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'agents.id.config.put', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  const workspaceId = request.nextUrl.searchParams.get('workspace_id');
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
  }
  if (!isValidUuid(workspaceId)) {
    return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
  }
  const permResult = await requirePermission(request, workspaceId, 'agents:configure');
  if (permResult instanceof NextResponse) return permResult;

  try {
    const { id } = await params;

    const agent = await loadAgentConfig(workspaceId, id);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    const agentName = agent.name;

    const parsed = await parseBody(request, agentConfigSchema);
    if (isErrorResponse(parsed)) return parsed;
    const {
      parameters,
      active_profile,
      display_name,
      role,
      description,
      color,
      persona_prompt,
      model,
      icon,
      budget_cap_usd,
    } = parsed;

    const supabase = await createClient();
    const upsertPayload: Record<string, unknown> = {
      agent_id: id,
    };
    if (workspaceId) upsertPayload.workspace_id = workspaceId;
    if (parameters !== undefined) upsertPayload.parameters = parameters;
    if (active_profile !== undefined) upsertPayload.active_profile = active_profile;
    if (display_name !== undefined) upsertPayload.display_name = display_name;
    if (role !== undefined) upsertPayload.role = role;
    if (description !== undefined) upsertPayload.description = description;
    if (color !== undefined) upsertPayload.color = color;
    if (persona_prompt !== undefined) upsertPayload.persona_prompt = persona_prompt;
    if (model !== undefined) upsertPayload.model = model;
    if (icon !== undefined) upsertPayload.icon = icon;
    if (budget_cap_usd !== undefined) upsertPayload.budget_cap_usd = budget_cap_usd;

    const { data, error } = await supabase
      .from('agent_configs')
      .upsert(upsertPayload)
      .select(
        'agent_id, display_name, role, description, color, persona_prompt, model, parameters, active_profile, budget_cap_usd',
      )
      .single();

    if (error) throw error;
    await createActivity(supabase, {
      event_type: 'agent.config_updated',
      severity: 'info',
      source: 'web',
      title: `Agent config updated: ${agentName}`,
      agent_id: id,
    });
    return NextResponse.json(data);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResult = await applyRateLimit(request, 'agents.id.config.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  const workspaceId = request.nextUrl.searchParams.get('workspace_id');
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
  }
  if (!isValidUuid(workspaceId)) {
    return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
  }

  const permResult = await requirePermission(request, workspaceId, 'agents:configure');
  if (permResult instanceof NextResponse) return permResult;

  try {
    const { id } = await params;
    const supabase = createServiceClient();

    // Check agent exists and is active
    const { data: agent, error: fetchError } = await supabase
      .from('agent_configs')
      .select('agent_id, display_name')
      .eq('workspace_id', workspaceId)
      .eq('agent_id', id)
      .eq('is_active', true)
      .single();

    if (fetchError || !agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Prevent deleting the last active agent
    const { count } = await supabase
      .from('agent_configs')
      .select('agent_id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);

    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: 'Cannot delete the last active agent' }, { status: 400 });
    }

    // Soft delete
    const { error: updateError } = await supabase
      .from('agent_configs')
      .update({ is_active: false })
      .eq('workspace_id', workspaceId)
      .eq('agent_id', id);

    if (updateError) throw updateError;

    const activitySupabase = await createClient();
    await createActivity(activitySupabase, {
      event_type: 'agent.deleted',
      severity: 'info',
      source: 'web',
      title: `Agent deleted: ${agent.display_name}`,
      agent_id: id,
    });

    return NextResponse.json({ success: true, agent_id: id });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
