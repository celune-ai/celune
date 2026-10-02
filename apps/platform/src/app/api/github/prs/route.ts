import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { githubCreatePrSchema } from '@/lib/schemas/github.schema';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

/**
 * GET /api/github/prs?workspace_id=X&project_id=Y&branch_name=Z&status=open
 * List project PRs with optional filters.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspace_id');
    const projectId = searchParams.get('project_id');
    const branchName = searchParams.get('branch_name');
    const status = searchParams.get('status');

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }
    if (!isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }
    if (projectId && !isValidUuid(projectId)) {
      return NextResponse.json({ error: 'Invalid project_id' }, { status: 400 });
    }

    const membershipError = await requireWorkspaceMembership(userId, workspaceId);
    if (membershipError) return membershipError;

    const supabase = createServiceClient();
    let query = supabase
      .from('project_prs')
      .select(
        'id, workspace_id, project_id, task_id, pr_number, pr_url, branch_name, title, status, ci_status, review_state, commits_behind_main, created_at, updated_at',
      )
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (projectId) query = query.eq('project_id', projectId);
    if (branchName) query = query.eq('branch_name', branchName);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return safeErrorResponse(error);

    return NextResponse.json({ prs: data ?? [] });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * POST /api/github/prs — Create or upsert a project PR record.
 * Called by /build, /git-push, or webhook handler.
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'github.prs.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const bodyParsed = githubCreatePrSchema.safeParse(rawBody);
    if (!bodyParsed.success) {
      return NextResponse.json(
        { error: bodyParsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { workspace_id, project_id, task_id, pr_number, pr_url, branch_name, title, status } =
      bodyParsed.data;

    const membershipError = await requireWorkspaceMembership(userId, workspace_id);
    if (membershipError) return membershipError;

    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('project_prs')
      .upsert(
        {
          workspace_id,
          project_id,
          task_id: task_id ?? null,
          pr_number,
          pr_url,
          branch_name,
          title: title ?? null,
          status: status ?? 'draft',
        },
        { onConflict: 'workspace_id,pr_number' },
      )
      .select(
        'id, workspace_id, project_id, task_id, pr_number, pr_url, branch_name, title, status, ci_status, review_state, commits_behind_main, created_at, updated_at',
      )
      .single();

    if (error) return safeErrorResponse(error);
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
