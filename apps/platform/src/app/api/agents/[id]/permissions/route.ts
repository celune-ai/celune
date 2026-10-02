import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@repo/db/server';
import { createActivity } from '@repo/db/queries';
import { AGENTS } from '@/lib/agents-data';
import type { AgentScope } from '@/lib/agents-data';
import { loadAgentConfig } from '@/lib/agent-loader';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { validateOrigin } from '@/lib/csrf';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
const permissionsSchema = z.object({ permissions: z.array(z.string()).nullable() }).strip();

export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/[id]/permissions?workspace_id=xxx
 *
 * Returns the effective permission scopes for an agent. Static defaults are
 * defined in agents-data.ts. RICK can store runtime overrides in
 * agent_configs.permissions (Supabase) — if present, the DB value takes
 * precedence over the static default.
 *
 * When workspace_id is provided, looks up the agent in that workspace's configs.
 *
 * Response:
 *   { agentId, permissions: AgentScope[], source: "static" | "override" }
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');

    // Workspace-scoped lookup
    if (workspaceId) {
      const agent = await loadAgentConfig(workspaceId, id);
      if (!agent) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
      }
      return NextResponse.json({
        agentId: id,
        permissions: agent.permissions,
        source: 'override',
      });
    }

    // Legacy: hardcoded agent lookup
    const agent = AGENTS.find((a) => a.id === id);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Check for a RICK runtime override stored in agent_configs
    const supabase = await createClient();
    const { data } = await supabase
      .from('agent_configs')
      .select('permissions')
      .eq('agent_id', id)
      .single();

    const hasOverride = data?.permissions != null;
    const permissions: AgentScope[] = hasOverride
      ? (data.permissions as AgentScope[])
      : agent.permissions;

    return NextResponse.json({
      agentId: id,
      permissions,
      source: hasOverride ? 'override' : 'static',
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * PUT /api/agents/[id]/permissions?workspace_id=xxx
 *
 * Stores a runtime permissions override for an agent in
 * agent_configs.permissions. Pass null to clear the override and revert to
 * static defaults.
 *
 * Body: { permissions: AgentScope[] | null }
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'agents.id.permissions.put', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    const permResult = await requirePermission(request, workspaceId, 'agents:configure');
    if (permResult instanceof NextResponse) return permResult;

    const parsed = await parseBody(request, permissionsSchema);
    if (isErrorResponse(parsed)) return parsed;

    const { id } = await params;

    // Validate agent exists
    let agentName: string;
    let defaultPermissions: AgentScope[];
    if (workspaceId) {
      const agent = await loadAgentConfig(workspaceId, id);
      if (!agent) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
      }
      agentName = agent.name;
      defaultPermissions = agent.permissions;
    } else {
      const agent = AGENTS.find((a) => a.id === id);
      if (!agent) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
      }
      agentName = agent.name;
      defaultPermissions = agent.permissions;
    }

    const permissions = parsed.permissions as AgentScope[] | null;

    const supabase = await createClient();

    if (permissions === null) {
      // Clear the override — revert to static defaults
      const updateQuery = supabase
        .from('agent_configs')
        .update({ permissions: null })
        .eq('agent_id', id);
      if (workspaceId) {
        updateQuery.eq('workspace_id', workspaceId);
      }
      await updateQuery;

      return NextResponse.json({
        agentId: id,
        permissions: defaultPermissions,
        source: 'static',
      });
    }

    // Validate scopes are known values
    const { ALL_SCOPES } = await import('@/lib/agents-data');
    const unknown = permissions.filter((s) => !ALL_SCOPES.includes(s));
    if (unknown.length > 0) {
      return NextResponse.json({ error: `Unknown scopes: ${unknown.join(', ')}` }, { status: 400 });
    }

    const upsertPayload: Record<string, unknown> = { agent_id: id, permissions };
    if (workspaceId) {
      upsertPayload.workspace_id = workspaceId;
    }

    const { data, error } = await supabase
      .from('agent_configs')
      .upsert(upsertPayload)
      .select('permissions')
      .single();

    if (error) throw error;

    await createActivity(supabase, {
      event_type: 'agent.permissions_updated',
      severity: 'warning',
      source: 'web',
      title: `Agent permissions overridden: ${agentName}`,
      agent_id: id,
    });

    return NextResponse.json({
      agentId: id,
      permissions: data.permissions as AgentScope[],
      source: 'override',
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
