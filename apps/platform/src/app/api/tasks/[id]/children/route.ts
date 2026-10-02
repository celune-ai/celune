import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { getChildTasks, areChildrenComplete } from '@repo/db/queries';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { getAuthUserId } from '@/lib/auth';
import { extractWorkspaceScope } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getAuthUserId(_request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const wsScope = extractWorkspaceScope(_request);
  if (wsScope instanceof NextResponse) return wsScope;
  const workspaceId = wsScope.workspace_id!;

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }
    const supabase = await createClient();
    const [children, all_complete] = await Promise.all([
      getChildTasks(supabase, id, workspaceId),
      areChildrenComplete(supabase, id, workspaceId),
    ]);
    return NextResponse.json({ children, all_complete });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
