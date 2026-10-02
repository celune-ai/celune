import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { resolveWorkspacePlan } from '@/lib/plan-enforcement';
import { extractRequiredWorkspaceId } from '@/lib/require-workspace';
import { requirePermission } from '@/lib/permissions';
import { getAuthUserId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface GateResult {
  status: 'pass' | 'fail';
  detail: string;
}

/**
 * Check if workspace has BYOK provider keys configured.
 */
async function checkApiKeys(workspaceId: string): Promise<GateResult> {
  try {
    const supabase = createServiceClient();
    const { count } = await supabase
      .from('provider_api_keys')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId);

    if ((count ?? 0) > 0) {
      return { status: 'pass', detail: `${count} provider key(s) configured` };
    }
    return { status: 'fail', detail: 'No provider keys configured. Add at least one API key.' };
  } catch (error) {
    console.error('[readiness] api_keys check failed:', error);
    return { status: 'fail', detail: 'Unable to verify provider keys' };
  }
}

/**
 * Check if basic onboarding steps are complete:
 * workspace has a name, and at least 1 agent is seeded.
 */
async function checkOnboarding(workspaceId: string): Promise<GateResult> {
  try {
    const supabase = createServiceClient();

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('name')
      .eq('id', workspaceId)
      .single();

    if (!workspace?.name) {
      return { status: 'fail', detail: 'Workspace name is not set' };
    }

    const { count: agentCount } = await supabase
      .from('agent_configs')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId);

    if ((agentCount ?? 0) === 0) {
      return { status: 'fail', detail: 'No agents configured. Seed at least one agent.' };
    }

    return { status: 'pass', detail: `Workspace "${workspace.name}" with ${agentCount} agent(s)` };
  } catch (error) {
    console.error('[readiness] onboarding check failed:', error);
    return { status: 'fail', detail: 'Unable to verify onboarding status' };
  }
}

/**
 * Check if workspace has an active plan and is within limits.
 */
async function checkPlan(workspaceId: string, userId?: string): Promise<GateResult> {
  try {
    const { plan, limits } = await resolveWorkspacePlan(workspaceId, userId);

    return {
      status: 'pass',
      detail: `Plan: ${plan} (${limits.features.length} features available)`,
    };
  } catch (error) {
    console.error('[readiness] plan check failed:', error);
    return { status: 'fail', detail: 'Unable to verify plan status' };
  }
}

/**
 * Check if workspace has a connected repository.
 */
async function checkWorkspaceRepo(workspaceId: string): Promise<GateResult> {
  try {
    const supabase = createServiceClient();

    // Get the org_id for this workspace, then check org_github_installations
    const { data: ws } = await supabase
      .from('workspaces')
      .select('org_id')
      .eq('id', workspaceId)
      .single();

    if (!ws?.org_id) {
      return { status: 'fail', detail: 'Workspace has no organization' };
    }

    const { count } = await supabase
      .from('org_github_installations')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', ws.org_id);

    if ((count ?? 0) > 0) {
      return { status: 'pass', detail: `${count} repo(s) connected` };
    }
    return { status: 'fail', detail: 'No repository connected to workspace' };
  } catch (error) {
    console.error('[readiness] workspace repo check failed:', error);
    return { status: 'fail', detail: 'Unable to verify repository connection' };
  }
}

/**
 * Check if the requesting user has an active role.
 */
async function checkAccount(workspaceId: string, userId: string | null): Promise<GateResult> {
  if (!userId) {
    return { status: 'fail', detail: 'No authenticated user' };
  }

  try {
    const supabase = createServiceClient();

    // Check workspace membership
    const { data: membership } = await supabase
      .from('workspace_memberships')
      .select('id, role_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership) {
      return { status: 'fail', detail: 'User is not a member of this workspace' };
    }

    return { status: 'pass', detail: 'Active workspace member' };
  } catch (error) {
    console.error('[readiness] account check failed:', error);
    return { status: 'fail', detail: 'Unable to verify account status' };
  }
}

/**
 * GET /api/readiness?workspace_id=xxx
 *
 * Returns pass/fail status for 5 readiness gates:
 * api_keys, onboarding, plan, workspace (repo), account.
 *
 * Each gate check is isolated — a failure in one does not crash the others.
 */
export async function GET(request: NextRequest) {
  try {
    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    // Verify the user is a member of this workspace
    const permResult = await requirePermission(request, workspaceId, 'settings:read');
    if (permResult instanceof NextResponse) return permResult;

    const userId = request.headers.get('x-user-id');

    // Run all gate checks in parallel for performance
    const [apiKeys, onboarding, plan, workspace, account] = await Promise.all([
      checkApiKeys(workspaceId),
      checkOnboarding(workspaceId),
      checkPlan(workspaceId, userId ?? undefined),
      checkWorkspaceRepo(workspaceId),
      checkAccount(workspaceId, userId),
    ]);

    const gates = { api_keys: apiKeys, onboarding, plan, workspace, account };
    const ready = Object.values(gates).every((g) => g.status === 'pass');

    return NextResponse.json(
      { gates, ready },
      {
        headers: {
          'Cache-Control': 'private, max-age=60, stale-while-revalidate=30',
        },
      },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
