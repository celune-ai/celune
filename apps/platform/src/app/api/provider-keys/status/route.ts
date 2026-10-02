import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { getAuthUserId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/provider-keys/status?workspace_id=xxx
 * Returns { has_key: boolean } indicating whether at least one active
 * provider API key exists for the workspace's org.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json(
        { error: 'workspace_id query parameter is required' },
        { status: 400 },
      );
    }

    // Service client: checks for active provider keys. Accesses: workspaces, provider_api_keys.
    const supabase = createServiceClient();

    // Resolve org_id from the workspace
    const { data: workspace, error: wsError } = await supabase
      .from('workspaces')
      .select('org_id')
      .eq('id', workspaceId)
      .single();

    if (wsError || !workspace?.org_id) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    // Check if any active provider key exists for this workspace or org
    const { count, error: keyError } = await supabase
      .from('provider_api_keys')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .or(`workspace_id.eq.${workspaceId},and(org_id.eq.${workspace.org_id},workspace_id.is.null)`);

    if (keyError) throw keyError;

    return NextResponse.json({ has_key: (count ?? 0) > 0 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
