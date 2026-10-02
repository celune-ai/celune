/**
 * GitHub branch management for workspaces.
 *
 * GET /api/github/branches?workspace_id=<id> — List branches on connected repo.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';
import { isGitHubAppConfigured } from '@/lib/github-app';
import { listBranches, getBranchStatus } from '@/lib/github-git';
import { parseGitHubUrl } from '@/lib/github-utils';
import { verifyOrgInstallation } from '@/lib/github-org';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    if (!isGitHubAppConfigured()) {
      return NextResponse.json(
        { error: 'GitHub App is not configured', code: 'github_app_not_configured' },
        { status: 503 },
      );
    }

    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const rl = await applyRateLimit(request, 'github.branches', RATE_READ);
    if (rl) return rl.blocked;

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }
    if (!isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }

    // Service client: reads workspace repo config. Accesses: org_members, workspaces.
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

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, repo_url, github_installation_id, github_default_branch')
      .eq('id', workspaceId)
      .eq('org_id', membership.org_id)
      .single();

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    if (!workspace.github_installation_id || !workspace.repo_url) {
      return NextResponse.json(
        { error: 'No repository connected to this workspace' },
        { status: 400 },
      );
    }

    // Verify installation belongs to this org
    const installation = await verifyOrgInstallation(
      supabase,
      membership.org_id,
      workspace.github_installation_id,
    );
    if (!installation) {
      return NextResponse.json(
        { error: 'Installation not registered for this organization' },
        { status: 400 },
      );
    }

    const repoFullName = parseGitHubUrl(workspace.repo_url)?.fullName ?? null;
    if (!repoFullName) {
      return NextResponse.json({ error: 'Invalid repo URL' }, { status: 400 });
    }

    const branches = await listBranches(workspace.github_installation_id, repoFullName);

    // Enrich celune/* branches with ahead/behind status
    const defaultBranch = workspace.github_default_branch ?? 'main';
    const enriched = await Promise.all(
      branches.map(async (branch) => {
        if (branch.name === defaultBranch) {
          return { ...branch, ahead: 0, behind: 0, is_default: true, is_celune: false };
        }

        const isCelune = branch.name.startsWith('celune/');
        try {
          const status = await getBranchStatus(
            workspace.github_installation_id!,
            repoFullName!,
            branch.name,
            defaultBranch,
          );
          return { ...branch, ...status, is_default: false, is_celune: isCelune };
        } catch {
          return { ...branch, ahead: 0, behind: 0, is_default: false, is_celune: isCelune };
        }
      }),
    );

    return NextResponse.json({
      branches: enriched,
      default_branch: defaultBranch,
      repo: repoFullName,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
