import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { resolveWorkspacePlan } from '@/lib/plan-enforcement';
import { extractRequiredWorkspaceId } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

/**
 * GET /api/workspaces/plan?workspace_id=xxx
 * Returns the current plan name, limits, and features for a workspace.
 * Also returns `is_workspace_owner`: true when the caller owns the workspace's org, the only
 * person who can subscribe for it. The client renders owner vs member UI on the paywall.
 */
export async function GET(request: NextRequest) {
  try {
    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    const userId = request.headers.get('x-user-id') ?? undefined;

    // Use the shared plan resolution logic
    const resolved = await resolveWorkspacePlan(workspaceId, userId);

    // The org owner is the billing entity: only they can subscribe for the org.
    let isOrgOwner = false;
    if (userId) {
      const supabase = createServiceClient();
      const { data: ws } = await supabase
        .from('workspaces')
        .select('org_id')
        .eq('id', workspaceId)
        .single();
      if (ws?.org_id) {
        const { data: org } = await supabase
          .from('organizations')
          .select('owner_id')
          .eq('id', ws.org_id)
          .single();
        isOrgOwner = org?.owner_id === userId;
      }
    }

    return NextResponse.json({
      plan: resolved.plan,
      limits: resolved.limits,
      features: resolved.limits.features,
      is_platform_owner: resolved.isPlatformOwner,
      past_due: resolved.pastDue,
      // Kept under this name for existing clients; it is the org owner, who pays.
      is_workspace_owner: isOrgOwner,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
