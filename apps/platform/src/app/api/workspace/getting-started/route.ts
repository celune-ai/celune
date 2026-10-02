import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';
import { extractRequiredWorkspaceId, requireWorkspaceMembership } from '@/lib/require-workspace';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// ─── Types ──────────────────────────────────────────────────────────────────

export type StepGroup = 'explore' | 'connect' | 'grow';

export interface GettingStartedStep {
  key: string;
  title: string;
  description: string;
  completed: boolean;
  /** Whether this step only appears when a precondition is met */
  conditional: boolean;
  /** Whether the precondition is currently met (always true for non-conditional) */
  available: boolean;
  group: StepGroup;
  href: string;
}

export interface GettingStartedResponse {
  steps: GettingStartedStep[];
  completed_count: number;
  total_count: number;
  /** Whether the post-onboarding agent is still generating projects & agents */
  generating: boolean;
  /** Whether generation encountered an error (allows retry UI) */
  generation_error: boolean;
}

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * GET /api/workspace/getting-started?workspace_id=xxx
 *
 * Returns getting-started checklist completion state for the workspace dashboard.
 * Each step checks existing tables to determine completion — no separate state table needed.
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

    const forbidden = await requireWorkspaceMembership(userId, workspaceId);
    if (forbidden) return forbidden;

    const supabase = createServiceClient();

    // Look up workspace to get org_id, plan info, and generation status
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('org_id, metadata')
      .eq('id', workspaceId)
      .single();

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const orgId = workspace.org_id;
    const wsMeta = (workspace.metadata as Record<string, unknown>) ?? {};
    const generationStatus = (wsMeta.onboarding_generation_status as string) ?? 'none';
    const generating = generationStatus === 'pending';
    const generationError = generationStatus === 'error';

    // Read visited steps from workspace metadata
    const visitedSteps: string[] = Array.isArray(wsMeta.visited_getting_started_steps)
      ? (wsMeta.visited_getting_started_steps as string[])
      : [];

    // Run all checks in parallel
    const [
      projectsRes,
      userProjectsRes,
      completedProjectsRes,
      agentsRes,
      memoriesRes,
      slackRes,
      githubRes,
      prsRes,
      workspacesRes,
      membershipsRes,
    ] = await Promise.all([
      // reviewed_projects: any projects in workspace (content exists to review)
      supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId),

      // created_project: projects that are not system type (user-created)
      supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .neq('project_type', 'system'),

      // completed_project: any project with status='completed'
      supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('status', 'completed'),

      // reviewed_team: agent configs in workspace (content exists to review)
      supabase
        .from('agent_configs')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId),

      // reviewed_memories: onboarding memories stored (content exists to review)
      supabase
        .from('agent_memory')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .like('source', '%onboarding%'),

      // has_comms: slack connections for workspace
      supabase
        .from('slack_connections')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId),

      // has_integrations: org-level GitHub installations
      orgId
        ? supabase
            .from('org_github_installations')
            .select('id', { count: 'exact', head: true })
            .eq('org_id', orgId)
            .eq('is_active', true)
        : Promise.resolve({ count: 0 }),

      // has_pr: project PRs for workspace
      supabase
        .from('project_prs')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId),

      // has_extra_workspace: more than 1 workspace in the org
      orgId
        ? supabase
            .from('workspaces')
            .select('id', { count: 'exact', head: true })
            .eq('org_id', orgId)
        : Promise.resolve({ count: 1 }),

      // has_teammates: more than 1 member in workspace
      supabase
        .from('workspace_memberships')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId),
    ]);

    const hasProjects = (projectsRes.count ?? 0) > 0;
    const hasUserProject = (userProjectsRes.count ?? 0) > 0;
    const hasCompletedProject = (completedProjectsRes.count ?? 0) > 0;
    const hasAgents = (agentsRes.count ?? 0) > 0;
    const hasMemories = (memoriesRes.count ?? 0) > 0;
    const hasComms = (slackRes.count ?? 0) > 0;
    const hasIntegrations = (githubRes.count ?? 0) > 0;
    const hasPr = (prsRes.count ?? 0) > 0;
    const hasExtraWorkspace = (workspacesRes.count ?? 0) > 1;
    const hasTeammates = (membershipsRes.count ?? 0) > 1;

    const steps: GettingStartedStep[] = [
      // Group 1: Explore — review what was generated, then create your own
      {
        key: 'reviewed_projects',
        title: 'Review Agent Projects',
        description: generating
          ? 'Your agent is creating personalized projects — this may take a few minutes.'
          : 'See the projects your agent created based on your onboarding conversation.',
        completed: visitedSteps.includes('reviewed_projects'),
        conditional: true,
        available: hasProjects || generating,
        group: 'explore',
        href: '/projects',
      },
      {
        key: 'reviewed_team',
        title: 'Review Agent Team',
        description: generating
          ? 'Your agent is configuring your team — this may take a few minutes.'
          : 'Meet the AI agents configured for your specific workflows.',
        completed: visitedSteps.includes('reviewed_team'),
        conditional: true,
        available: hasAgents || generating,
        group: 'explore',
        href: '/agents',
      },
      {
        key: 'reviewed_memories',
        title: 'Review your Memories',
        description: generating
          ? 'Saving insights from your onboarding conversation...'
          : 'See what your agent learned about you during onboarding.',
        completed: visitedSteps.includes('reviewed_memories'),
        conditional: true,
        available: hasMemories || generating,
        group: 'explore',
        href: '/memory',
      },
      {
        key: 'created_project',
        title: 'Create a /project',
        description:
          'Start a new project in Celune, or use /project-plan or /project-research in your IDE.',
        completed: hasUserProject,
        conditional: false,
        available: true,
        group: 'explore',
        href: '/projects',
      },
      {
        key: 'completed_project',
        title: 'Complete a Project',
        description:
          'Finish a project by completing all its tasks — or mark it complete from the project page.',
        completed: hasCompletedProject,
        conditional: false,
        available: true,
        group: 'explore',
        href: '/projects',
      },

      // Group 2: Connect
      {
        key: 'has_comms',
        title: 'Connect to communications',
        description:
          'Link Slack, Discord, or other tools to receive notifications and interact with agents.',
        completed: hasComms,
        conditional: false,
        available: true,
        group: 'connect',
        href: '/settings?tab=integrations',
      },
      {
        key: 'has_integrations',
        title: 'Connect GitHub',
        description: 'Link a GitHub organization to enable code workflows and PR tracking.',
        completed: hasIntegrations,
        conditional: false,
        available: true,
        group: 'connect',
        href: '/settings?tab=integrations',
      },
      {
        key: 'has_pr',
        title: 'Ship a pull request',
        description: 'Create and merge a PR to see it tracked in your project.',
        completed: hasPr,
        conditional: true,
        available: hasIntegrations,
        group: 'connect',
        href: '/projects',
      },

      // Group 3: Grow
      {
        key: 'has_extra_workspace',
        title: 'Create another workspace',
        description: 'Separate projects and teams with dedicated workspaces.',
        completed: hasExtraWorkspace,
        conditional: false,
        available: true,
        group: 'grow',
        href: '/settings?tab=workspaces',
      },
      {
        key: 'has_teammates',
        title: 'Invite a teammate',
        description: 'Collaborate with others by adding team members to your workspace.',
        completed: hasTeammates,
        conditional: false,
        available: true,
        group: 'grow',
        href: '/settings?tab=members',
      },
    ];

    // Filter to only available steps for counts
    const availableSteps = steps.filter((s) => !s.conditional || s.available);
    const completed_count = availableSteps.filter((s) => s.completed).length;

    return NextResponse.json(
      {
        steps,
        completed_count,
        total_count: availableSteps.length,
        generating,
        generation_error: generationError,
      } satisfies GettingStartedResponse,
      { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=15' } },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}

// ─── POST: Record a step visit ──────────────────────────────────────────────

const stepVisitSchema = z.object({
  workspace_id: z.string().uuid(),
  step_key: z.string().min(1),
});

type StepVisitBody = z.infer<typeof stepVisitSchema>;

/**
 * POST /api/workspace/getting-started
 *
 * Records that the user visited/clicked a getting-started step.
 * Body: { workspace_id: string, step_key: string }
 */
export const POST = withApiSecurity<StepVisitBody>(
  async (_request: NextRequest, { userId, body }: SecurityContext<StepVisitBody>) => {
    const { workspace_id, step_key } = body;

    const forbidden = await requireWorkspaceMembership(userId, workspace_id);
    if (forbidden) return forbidden;

    const supabase = createServiceClient();

    // Read current workspace metadata
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('metadata')
      .eq('id', workspace_id)
      .single();

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const meta = (workspace.metadata as Record<string, unknown>) ?? {};
    const visited: string[] = Array.isArray(meta.visited_getting_started_steps)
      ? (meta.visited_getting_started_steps as string[])
      : [];

    // Only add if not already recorded
    if (!visited.includes(step_key)) {
      visited.push(step_key);
      await supabase
        .from('workspaces')
        .update({ metadata: { ...meta, visited_getting_started_steps: visited } })
        .eq('id', workspace_id);
    }

    return NextResponse.json({ ok: true });
  },
  {
    rateLimit: { tier: RATE_WRITE, routeKey: 'workspace.getting-started.post' },
    parseBody: stepVisitSchema,
  },
);
