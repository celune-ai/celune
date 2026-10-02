import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { safeErrorResponse } from '@/lib/api-error';
import { getAuthUserId } from '@/lib/auth';
import { extractRequiredWorkspaceId, requireWorkspaceMembership } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

// Returns agent_status rows keyed by agent_name (lowercased) for easy lookup.
// UI falls back to static defaults for any agent not present in the table.
// workspace_id query param is REQUIRED — no unscoped global queries.
export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const workspaceId = extractRequiredWorkspaceId(request);
    if (workspaceId instanceof NextResponse) return workspaceId;

    const membershipError = await requireWorkspaceMembership(userId, workspaceId);
    if (membershipError) return membershipError;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('agent_status')
      .select('agent_name, status, last_heartbeat, current_task_id, model')
      .eq('workspace_id', workspaceId);

    if (error) throw error;

    // Auto-cleanup: if an agent is stuck in 'working' with a stale heartbeat
    // (>1 hour ago), reset it to 'online' so the UI doesn't show a false active state.
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const staleAgents = (data ?? []).filter((row) => {
      if (row.status !== 'working') return false;
      if (!row.last_heartbeat) return true;
      return Date.now() - new Date(row.last_heartbeat).getTime() > ONE_HOUR_MS;
    });

    if (staleAgents.length > 0) {
      await supabase
        .from('agent_status')
        .update({ status: 'online', current_task_id: null })
        .in(
          'agent_name',
          staleAgents.map((r) => r.agent_name),
        )
        .eq('workspace_id', workspaceId);
      // Reflect the cleanup in the in-memory rows so the response is consistent.
      for (const row of staleAgents) {
        row.status = 'online';
        row.current_task_id = null;
      }
    }

    const statusMap: Record<
      string,
      {
        status: string;
        last_heartbeat: string | null;
        current_task_id: string | null;
        model: string | null;
      }
    > = {};

    for (const row of data ?? []) {
      statusMap[row.agent_name.toLowerCase()] = {
        status: row.status,
        last_heartbeat: row.last_heartbeat,
        current_task_id: row.current_task_id,
        model: row.model,
      };
    }

    return NextResponse.json(statusMap);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
