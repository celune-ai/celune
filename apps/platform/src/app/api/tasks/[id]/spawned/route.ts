import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { extractWorkspaceScope } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }

    // Workspace scope is required for spawned task list queries
    const wsScope = extractWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    const supabase = await createClient();

    let query = supabase
      .from('tasks')
      .select(
        'id, title, status, priority, assignee, project_id, spawned_by, sort_order, created_at, updated_at',
      )
      .eq('spawned_by', id)
      .order('sort_order', { ascending: true })
      .limit(500);
    if (wsScope.workspace_ids) {
      query = query.in('workspace_id', wsScope.workspace_ids);
    } else {
      query = query.eq('workspace_id', wsScope.workspace_id!);
    }

    const { data, error } = await query;

    if (error) throw error;
    return NextResponse.json({ tasks: data ?? [] });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
