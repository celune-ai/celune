import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { getTask } from '@repo/db/queries';
import { isValidUuid } from '@repo/db/validation';
import type { Task } from '@repo/types';
import { safeErrorResponse } from '@/lib/api-error';
import { getAuthUserId } from '@/lib/auth';
import { extractWorkspaceScope } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getAuthUserId(_request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Require workspace scope to prevent cross-workspace data access
  const wsScope = extractWorkspaceScope(_request);
  if (wsScope instanceof NextResponse) return wsScope;

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }
    const supabase = await createClient();
    // Scope task lookup to workspace (IDOR prevention)
    const wsId = wsScope.workspace_id!;
    const task = await getTask(supabase, id, wsId);
    const depIds = (task as Task & { depends_on?: string[] }).depends_on ?? [];

    if (depIds.length === 0) {
      return NextResponse.json({ dependencies: [] });
    }

    const { data, error } = await supabase
      .from('tasks')
      .select('id, title, status, priority, assignee, project_id')
      .in('id', depIds)
      .eq('workspace_id', wsId);

    if (error) throw error;

    return NextResponse.json({ dependencies: data ?? [] });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
