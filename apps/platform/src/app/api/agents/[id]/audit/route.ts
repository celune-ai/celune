import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { getAgentAuditTrail } from '@repo/db/queries';
import { isValidUuid } from '@repo/db/validation';
import { AGENTS } from '@/lib/agents-data';
import { loadAgentConfig } from '@/lib/agent-loader';
import { safeErrorResponse } from '@/lib/api-error';
import { getAuthUserId } from '@/lib/auth';
import { extractWorkspaceScope, requireWorkspaceMembership } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    // Workspace scope is required for audit trail queries
    const wsScope = extractWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    // Verify membership for the workspace(s) being queried
    const scopeWorkspaceId = 'workspace_id' in wsScope ? wsScope.workspace_id : undefined;
    const scopeWorkspaceIds = 'workspace_ids' in wsScope ? wsScope.workspace_ids : undefined;

    if (scopeWorkspaceId) {
      const membershipError = await requireWorkspaceMembership(userId, scopeWorkspaceId);
      if (membershipError) return membershipError;
    } else if (scopeWorkspaceIds) {
      for (const wsId of scopeWorkspaceIds) {
        const membershipError = await requireWorkspaceMembership(userId, wsId);
        if (membershipError) return membershipError;
      }
    }

    const workspaceId = scopeWorkspaceId ?? scopeWorkspaceIds?.[0];
    if (workspaceId && !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }

    // Workspace-scoped agent lookup with hardcoded fallback
    const agent = workspaceId
      ? await loadAgentConfig(workspaceId, id)
      : (AGENTS.find((a) => a.id === id) ?? null);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const supabase = await createClient();
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;
    const offset = searchParams.get('offset') ? Number(searchParams.get('offset')) : undefined;

    const result = await getAgentAuditTrail(supabase, id, { limit, offset, ...wsScope });
    return NextResponse.json(result);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
