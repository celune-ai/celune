import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { getTask, getAgentMemoryByKeys } from '@repo/db/queries';
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

    // Workspace scope is required for memory key lookups
    const wsScope = extractWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    const supabase = await createClient();
    // Scope task lookup to workspace to prevent cross-workspace data access (IDOR)
    const task = await getTask(supabase, id, wsScope.workspace_id!);
    const keys = task.context_keys ?? [];
    const entries = keys.length > 0 ? await getAgentMemoryByKeys(supabase, keys, wsScope) : [];
    return NextResponse.json({ context_keys: keys, entries });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
