/**
 * Org-level GitHub installation disconnect and impact check.
 *
 * GET    /api/github/installations/[installationId]?action=impact
 *   Pre-disconnect impact check — returns count of affected workspaces, repos, PRs.
 *
 * DELETE /api/github/installations/[installationId]
 *   Disconnect a GitHub installation from the org with full cascade cleanup.
 *   Requires org owner role.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';
import { disconnectOrgInstallation, verifyOrgInstallation } from '@/lib/github-org';
import { validateOrigin } from '@/lib/csrf';
import { deactivateIntegrationMemories } from '@/lib/seed-knowledge-packs';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ installationId: string }> },
) {
  try {
    const { installationId: installationIdStr } = await params;
    const installationId = parseInt(installationIdStr, 10);
    if (isNaN(installationId)) {
      return NextResponse.json({ error: 'Invalid installation ID' }, { status: 400 });
    }

    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const supabase = createServiceClient();

    const { data: membership } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!membership?.org_id) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Verify installation belongs to this org
    const installation = await verifyOrgInstallation(supabase, membership.org_id, installationId);
    if (!installation) {
      return NextResponse.json({ error: 'Installation not found' }, { status: 404 });
    }

    // Impact check — count affected workspaces and active PRs
    const { data: affectedWorkspaces } = await supabase
      .from('workspaces')
      .select('id, name, repo_url')
      .eq('org_id', membership.org_id)
      .eq('github_installation_id', installationId);

    const workspaceIds = (affectedWorkspaces ?? []).map((w) => w.id);

    let activePRCount = 0;
    if (workspaceIds.length > 0) {
      const { count } = await supabase
        .from('project_prs')
        .select('id', { count: 'exact', head: true })
        .in('workspace_id', workspaceIds)
        .in('status', ['draft', 'open']);
      activePRCount = count ?? 0;
    }

    return NextResponse.json({
      installation,
      impact: {
        workspaces: affectedWorkspaces ?? [],
        workspace_count: workspaceIds.length,
        active_pr_count: activePRCount,
      },
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ installationId: string }> },
) {
  const rateLimitResult = await applyRateLimit(
    request,
    'github.installations.installationId.delete',
    RATE_WRITE,
  );
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const { installationId: installationIdStr } = await params;
    const installationId = parseInt(installationIdStr, 10);
    if (isNaN(installationId)) {
      return NextResponse.json({ error: 'Invalid installation ID' }, { status: 400 });
    }

    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const supabase = createServiceClient();

    // Verify user is org OWNER (not just member)
    const { data: membership } = await supabase
      .from('org_members')
      .select('org_id, is_owner')
      .eq('user_id', userId)
      .eq('is_owner', true)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!membership?.org_id) {
      return NextResponse.json(
        { error: 'Only organization owners can disconnect GitHub accounts' },
        { status: 403 },
      );
    }

    // Verify installation belongs to this org
    const installation = await verifyOrgInstallation(supabase, membership.org_id, installationId);
    if (!installation) {
      return NextResponse.json({ error: 'Installation not found' }, { status: 404 });
    }

    // Execute disconnect cascade
    const affectedWorkspaceIds = await disconnectOrgInstallation(
      supabase,
      membership.org_id,
      installationId,
    );

    // Deactivate GitHub-gated memories for all affected workspaces
    for (const wsId of affectedWorkspaceIds) {
      void deactivateIntegrationMemories(wsId, 'github').catch((err) => {
        console.error(`[github/disconnect] memory deactivation failed for workspace ${wsId}:`, err);
      });
    }

    // Log to activity_log
    await supabase.from('activity_log').insert({
      action: 'github_installation_disconnected',
      entity_type: 'organization',
      entity_id: membership.org_id,
      metadata: {
        installation_id: installationId,
        account_login: installation.github_account_login,
        affected_workspace_count: affectedWorkspaceIds.length,
        affected_workspace_ids: affectedWorkspaceIds,
        disconnected_by: userId,
      },
    });

    return NextResponse.json({
      ok: true,
      disconnected: {
        installation_id: installationId,
        account_login: installation.github_account_login,
        affected_workspaces: affectedWorkspaceIds.length,
      },
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
