import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { resolvePermissions } from '@/lib/permissions';
import { safeErrorResponse } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * GET /api/user/permissions?workspace_id=<uuid>
 *
 * Returns the current user's resolved permissions for a workspace.
 * Used by the client-side usePermissions() hook.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id') ?? '';
    if (workspaceId && !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const resolved = await resolvePermissions(supabase, userId, workspaceId);

    return NextResponse.json({
      permissions: Array.from(resolved.permissions),
      isOwner: resolved.isOwner,
      isPlatformOwner: resolved.isPlatformOwner,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
