export const dynamic = 'force-dynamic';

import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey } from '@/lib/api-key-auth';
import { createServiceClient } from '@repo/db/service';
import { API_KEY_BEARER_PREFIX } from '@/lib/api-keys';

// Number of MCP tools registered in /api/mcp route.ts buildMcpServer()
const MCP_TOOL_COUNT = 16;
const API_VERSION = '1.0.0';

/**
 * GET /api/mcp/health
 *
 * Lightweight health check for CLI tools to verify their API key
 * and connection to the Celune MCP server.
 *
 * No CSRF validation — CLI requests don't have Origin headers.
 * No rate limiting — read-only, lightweight.
 */
export async function GET(request: NextRequest) {
  const result = await authenticateApiKey(request);

  if (result instanceof NextResponse) {
    return result;
  }

  if (!result) {
    return NextResponse.json(
      { error: `API key required. Use Authorization: Bearer ${API_KEY_BEARER_PREFIX}...` },
      { status: 401 },
    );
  }

  const { workspaceId, userId, scopes } = result;

  // Fetch workspace and user info in parallel
  const supabase = createServiceClient();
  const [workspaceResult, userResult] = await Promise.all([
    supabase.from('workspaces').select('id, name, slug').eq('id', workspaceId).single(),
    supabase
      .from('auth.users' as 'workspaces')
      .select('email')
      .eq('id', userId)
      .single(),
  ]);

  const workspace = workspaceResult.data;
  const user = userResult.data as Record<string, string> | null;

  return NextResponse.json({
    status: 'connected',
    workspace: {
      id: workspaceId,
      name: workspace?.name ?? 'unknown',
      slug: workspace?.slug ?? 'unknown',
    },
    user: {
      id: userId,
      email: user?.email ?? 'unknown',
    },
    tools_available: MCP_TOOL_COUNT,
    api_version: API_VERSION,
    scopes,
  });
}
