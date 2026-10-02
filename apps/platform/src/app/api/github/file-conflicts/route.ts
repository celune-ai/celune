import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { safeErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

/**
 * GET /api/github/file-conflicts?workspace_id=X&project_id=Y
 * Check for file-level overlaps between this project's active PRs
 * and other active PRs in the same workspace.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rl = await applyRateLimit(request, 'github.file-conflicts', RATE_READ);
    if (rl) return rl.blocked;

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspace_id');
    const projectId = searchParams.get('project_id');

    if (!workspaceId || !projectId) {
      return NextResponse.json(
        { error: 'workspace_id and project_id are required' },
        { status: 400 },
      );
    }
    if (!isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }
    if (!isValidUuid(projectId)) {
      return NextResponse.json({ error: 'Invalid project_id' }, { status: 400 });
    }

    const membershipError = await requireWorkspaceMembership(userId, workspaceId);
    if (membershipError) return membershipError;

    const supabase = createServiceClient();

    const { data, error } = await supabase.rpc('check_file_overlap', {
      p_project_id: projectId,
      p_workspace_id: workspaceId,
    });

    if (error) return safeErrorResponse(error);

    return NextResponse.json({
      conflicts: data ?? [],
      has_conflicts: (data ?? []).length > 0,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
