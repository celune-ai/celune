import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { extractRequiredWorkspaceId } from '@/lib/require-workspace';
import { getEmployedAgents } from '@/lib/agent-employment';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/available?workspace_id=xxx
 * Returns only employed (active) agents for a workspace.
 * Lightweight endpoint for task assignment UIs and MCP tools.
 */
export async function GET(request: NextRequest) {
  try {
    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    const permResult = await requirePermission(request, workspaceId, 'agents:read');
    if (permResult instanceof NextResponse) return permResult;

    const agents = await getEmployedAgents(workspaceId);

    return NextResponse.json(agents, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=15' },
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
