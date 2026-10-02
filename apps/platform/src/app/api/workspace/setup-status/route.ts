import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';
import { extractRequiredWorkspaceId, requireWorkspaceMembership } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SetupStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  action_url: string;
}

export interface SetupStatusResponse {
  steps: SetupStep[];
  completed_count: number;
  total_count: number;
  onboarding_completed_at: string | null;
}

/**
 * GET /api/workspace/setup-status?workspace_id=xxx
 *
 * Returns onboarding checklist state for the workspace dashboard.
 * Requires authentication and workspace membership.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    if (!UUID_RE.test(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id format' }, { status: 400 });
    }

    const forbidden = await requireWorkspaceMembership(userId, workspaceId);
    if (forbidden) return forbidden;

    const supabase = createServiceClient();

    // Run all checks in parallel
    // First fetch workspace to get org_id for key lookup
    const workspaceRes = await supabase
      .from('workspaces')
      .select('name, repo_url, metadata, org_id')
      .eq('id', workspaceId)
      .single();

    const orgId = workspaceRes.data?.org_id;

    const [projectsRes, tasksRes, repoRes, agentsRes] = await Promise.all([
      supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId),
      supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId),
      supabase
        .from('workspace_repos')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId),
      supabase
        .from('agent_configs')
        .select('agent_id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId),
    ]);

    // Check for active provider key scoped to the org (requires org_id from workspace fetch)
    let hasApiKeys = false;
    if (orgId) {
      const apiKeysRes = await supabase
        .from('provider_api_keys')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('is_active', true);
      hasApiKeys = (apiKeysRes.count ?? 0) > 0;
    }

    const workspace = workspaceRes.data;
    const hasProjects = (projectsRes.count ?? 0) > 0;
    const hasTasks = (tasksRes.count ?? 0) > 0;
    const hasRepo = (repoRes.count ?? 0) > 0 || !!workspace?.repo_url;
    const hasAgents = (agentsRes.count ?? 0) > 0;

    const steps: SetupStep[] = [
      {
        id: 'workspace',
        title: 'Name your workspace',
        description: 'Give your workspace a name to identify it.',
        completed: !!workspace?.name,
        action_url: '/settings',
      },
      {
        id: 'api_keys',
        title: 'Add your API keys',
        description:
          'Your agent used platform credits during onboarding. Add your own keys to continue.',
        completed: hasApiKeys,
        action_url: '/settings?tab=api-keys',
      },
      {
        id: 'agents',
        title: 'Set up your AI team',
        description: 'Configure at least one AI agent to assist your workflow.',
        completed: hasAgents,
        action_url: '/agents',
      },
      {
        id: 'project',
        title: 'Create a project',
        description: 'Projects organize related tasks and track progress.',
        completed: hasProjects,
        action_url: '/projects',
      },
      {
        id: 'task',
        title: 'Create your first task',
        description: 'Tasks are units of work tracked on the kanban board.',
        completed: hasTasks,
        action_url: '/tasks',
      },
      {
        id: 'github',
        title: 'Connect GitHub',
        description: 'Link a repository to enable Git workflows and PR tracking.',
        completed: hasRepo,
        action_url: '/settings?tab=integrations',
      },
    ];

    const completed_count = steps.filter((s) => s.completed).length;
    const meta = (workspace?.metadata ?? {}) as Record<string, unknown>;
    const onboarding_completed_at =
      typeof meta.onboarding_completed_at === 'string' ? meta.onboarding_completed_at : null;

    return NextResponse.json(
      {
        steps,
        completed_count,
        total_count: steps.length,
        onboarding_completed_at,
      } satisfies SetupStatusResponse,
      { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=15' } },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
