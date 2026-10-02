import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { getComments, createComment, createActivity } from '@repo/db/queries';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { createCommentSchema } from '@/lib/schemas/comments.schema';
import { requirePermission } from '@/lib/permissions';
import { validateOrigin } from '@/lib/csrf';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }
    const supabase = await createClient();
    const comments = await getComments(supabase, id, workspaceId);
    return NextResponse.json(comments);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'tasks.id.comments.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  const workspaceId = request.nextUrl.searchParams.get('workspace_id');
  const permResult = await requirePermission(request, workspaceId, 'tasks:update');
  if (permResult instanceof NextResponse) return permResult;

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }
    const supabase = await createClient();
    const parsed = await parseBody(request, createCommentSchema);
    if (isErrorResponse(parsed)) return parsed;

    const comment = await createComment(supabase, {
      task_id: id,
      author: parsed.author,
      content: parsed.content,
    });

    await createActivity(supabase, {
      event_type: 'task.comment_added',
      severity: 'info',
      source: 'web',
      title: `Comment added by ${parsed.author}`,
      task_id: id,
      agent_id: parsed.author,
      actor_user_id: permResult.userId,
      workspace_id: workspaceId,
    });

    return NextResponse.json(comment, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
