import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { safeErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

/**
 * GET /api/github/context?workspace_id=X&branch=Y
 *
 * Resolves the full context chain for a branch:
 * branch → project (via project_prs) → PR status → task count
 *
 * Used by skills (/build, /git-push, /refresh) for conversation context auto-detection.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rl = await applyRateLimit(request, 'github.context', RATE_READ);
    if (rl) return rl.blocked;

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspace_id');
    const branchName = searchParams.get('branch');

    if (!workspaceId || !branchName) {
      return NextResponse.json({ error: 'workspace_id and branch are required' }, { status: 400 });
    }
    if (!isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }

    const membershipError = await requireWorkspaceMembership(userId, workspaceId);
    if (membershipError) return membershipError;

    const supabase = createServiceClient();

    // 1. Look up branch in project_prs (most recent non-closed PR)
    const { data: pr } = await supabase
      .from('project_prs')
      .select(
        'id, project_id, pr_number, pr_url, status, ci_status, review_state, commits_behind_main',
      )
      .eq('workspace_id', workspaceId)
      .eq('branch_name', branchName)
      .in('status', ['draft', 'open'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // 2. If no PR record, try to match branch to project via metadata
    let projectId: string | null = pr?.project_id ?? null;
    let projectName: string | null = null;

    if (!projectId) {
      const { data: projects } = await supabase
        .from('projects')
        .select('id, name')
        .eq('workspace_id', workspaceId)
        .contains('metadata', { branch: branchName });

      if (projects?.length) {
        projectId = projects[0].id;
        projectName = projects[0].name;
      }
    } else {
      // Get project name from PR's project_id
      const { data: project } = await supabase
        .from('projects')
        .select('name')
        .eq('id', projectId)
        .single();
      projectName = project?.name ?? null;
    }

    // 3. Count remaining tasks
    let tasksRemaining: number | null = null;
    if (projectId) {
      const { count } = await supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .neq('status', 'done');
      tasksRemaining = count;
    }

    // 4. Get workspace name
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('name, github_settings')
      .eq('id', workspaceId)
      .single();

    // 5. Check file conflicts if we have a project
    let conflicts: unknown[] = [];
    if (projectId) {
      const { data: conflictData } = await supabase.rpc('check_file_overlap', {
        p_project_id: projectId,
        p_workspace_id: workspaceId,
      });
      conflicts = conflictData ?? [];
    }

    return NextResponse.json({
      context: {
        workspace_id: workspaceId,
        workspace_name: workspace?.name ?? 'Unknown',
        project_id: projectId,
        project_name: projectName,
        branch: branchName,
        pr_number: pr?.pr_number ?? null,
        pr_status: pr?.status ?? null,
        pr_url: pr?.pr_url ?? null,
        ci_status: pr?.ci_status ?? null,
        review_state: pr?.review_state ?? null,
        tasks_remaining: tasksRemaining,
        commits_behind_main: pr?.commits_behind_main ?? null,
      },
      github_settings: workspace?.github_settings ?? null,
      conflicts,
      // Pre-formatted summary line for CLI display
      summary: formatSummary(
        projectName,
        pr?.pr_number,
        pr?.status,
        pr?.ci_status,
        tasksRemaining,
        branchName,
      ),
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

function formatSummary(
  projectName: string | null,
  prNumber: number | null,
  prStatus: string | null,
  ciStatus: string | null,
  tasksRemaining: number | null,
  branch: string,
): string {
  if (!projectName) {
    return `On branch ${branch} — no linked project.`;
  }

  const parts: string[] = [`Working on ${projectName}`];

  if (prNumber) {
    const statusStr = prStatus === 'draft' ? ' (draft)' : prStatus === 'merged' ? ' (merged)' : '';
    parts[0] += `, PR #${prNumber}${statusStr}`;
  }

  if (ciStatus === 'failing') {
    parts.push('CI failing');
  }

  if (tasksRemaining !== null && tasksRemaining > 0) {
    parts.push(`${tasksRemaining} tasks remaining`);
  }

  return parts.join('. ') + '.';
}
