/**
 * GET /api/projects/progress — Get progress log for a project
 *
 * Aggregates task completion outcomes into a timeline view.
 * No new table needed — pulls from tasks (outcomes) + activity_log.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import { RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

interface ProgressEntry {
  id: string;
  timestamp: string;
  agent: string;
  task_title: string;
  task_id: string;
  outcome: string;
  sprint: number | null;
}

export const GET = withApiSecurity(
  async (request: NextRequest, { userId }: SecurityContext) => {
    const url = new URL(request.url);
    const projectId = url.searchParams.get('project_id');
    const workspaceId = url.searchParams.get('workspace_id');

    if (!projectId || !workspaceId) {
      return NextResponse.json({ error: 'project_id and workspace_id required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Verify membership
    const { data: membership } = await supabase
      .from('workspace_memberships')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Verify project belongs to this workspace (prevents cross-workspace data leak)
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Fetch completed tasks with outcomes for this project
    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('id, title, status, assignee, outcome, updated_at, metadata')
      .eq('project_id', projectId)
      .eq('workspace_id', workspaceId)
      .eq('status', 'done')
      .not('outcome', 'is', null)
      .order('updated_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch progress' }, { status: 500 });
    }

    const entries: ProgressEntry[] = (tasks ?? []).map((task) => {
      const meta = task.metadata as Record<string, unknown> | null;
      const sprint = typeof meta?.sprint === 'number' ? meta.sprint : null;
      return {
        id: task.id,
        timestamp: task.updated_at,
        agent: task.assignee ?? 'unknown',
        task_title: task.title,
        task_id: task.id,
        outcome: task.outcome,
        sprint,
      };
    });

    return NextResponse.json({ entries });
  },
  { rateLimit: { tier: RATE_READ, routeKey: 'project-progress' } },
);
