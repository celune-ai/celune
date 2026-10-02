import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';
import { seedDefaultAgents, copyAgentsFromWorkspace } from '@/lib/agent-seed';
import { resolveWorkspacePlan } from '@/lib/plan-enforcement';
import { z } from 'zod';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';

export const dynamic = 'force-dynamic';

const createWorkspaceSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be 100 characters or fewer')
    .transform((s) => s.trim()),
  icon: z.string().max(10).optional().nullable(),
  repo_url: z.string().url().max(500).optional().nullable(),
  repo_provider: z.string().max(50).optional().nullable(),
  repo_path: z.string().max(500).optional().nullable(),
  github_default_branch: z.string().max(200).optional().nullable(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const supabase = createServiceClient();

    // Get the user's org membership
    const { data: membership } = await supabase
      .from('org_members')
      .select('org_id, is_owner, is_active, role_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!membership?.org_id) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Resolve role slug from role_id
    let roleSlug = 'member';
    if (membership.role_id) {
      const { data: role } = await supabase
        .from('roles')
        .select('slug')
        .eq('id', membership.role_id)
        .maybeSingle();
      if (role?.slug) roleSlug = role.slug;
    }
    const isPrivileged = membership.is_owner || roleSlug === 'owner' || roleSlug === 'admin';

    if (isPrivileged) {
      // Owner/admin: return all org workspaces
      const { data: workspaces, error: workspacesError } = await supabase
        .from('workspaces')
        .select(
          'id, name, slug, icon, is_default, description, status, color_scheme, metadata, github_settings, created_at, updated_at, org_id, repo_url, repo_provider, repo_path, repo_connected_at, github_installation_id, parent_workspace_id',
        )
        .eq('org_id', membership.org_id)
        .order('is_default', { ascending: false })
        .order('name', { ascending: true });

      if (workspacesError) throw workspacesError;

      return NextResponse.json(workspaces ?? []);
    } else {
      // Member/viewer: only return workspaces they have explicit membership in
      const { data: memberships, error: membershipsError } = await supabase
        .from('workspace_memberships')
        .select(
          'workspace:workspaces(id, name, slug, icon, is_default, description, status, color_scheme, metadata, github_settings, created_at, updated_at, org_id, repo_url, repo_provider, repo_path, repo_connected_at, github_installation_id, parent_workspace_id)',
        )
        .eq('user_id', userId);

      if (membershipsError) throw membershipsError;

      type WsRow = {
        id: string;
        name: string;
        slug: string;
        icon: string | null;
        is_default: boolean;
        description: string | null;
        status: string;
        color_scheme: string | null;
        metadata: Record<string, unknown> | null;
        created_at: string;
        updated_at: string;
        org_id: string;
        repo_url: string | null;
        repo_provider: string;
        repo_path: string | null;
        repo_connected_at: string | null;
        github_installation_id: number | null;
        parent_workspace_id: string | null;
      };
      const workspaces = (memberships ?? [])
        .map((m) => (Array.isArray(m.workspace) ? m.workspace[0] : m.workspace) as WsRow | null)
        .filter((w): w is WsRow => w !== null)
        .sort((a, b) => {
          if (a.is_default && !b.is_default) return -1;
          if (!a.is_default && b.is_default) return 1;
          return a.name.localeCompare(b.name);
        });

      return NextResponse.json(workspaces);
    }
  } catch (error) {
    return safeErrorResponse(error);
  }
}

type CreateWorkspaceBody = z.infer<typeof createWorkspaceSchema>;

export const POST = withApiSecurity<CreateWorkspaceBody>(
  async (_request: NextRequest, { userId, body }: SecurityContext<CreateWorkspaceBody>) => {
    const supabase = createServiceClient();

    const { name, icon, repo_url, repo_provider, repo_path, github_default_branch } = body;

    // Get user's org
    const { data: membership, error: membershipError } = await supabase
      .from('org_members')
      .select('org_id, is_owner')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!membership?.org_id) {
      console.error(
        '[workspaces] POST: No active org membership for user:',
        userId,
        membershipError,
      );
      return NextResponse.json(
        { error: 'No organization found. Please complete onboarding or contact support.' },
        { status: 404 },
      );
    }

    // Generate unique slug
    let slug = slugify(name.trim());
    const { data: existing } = await supabase
      .from('workspaces')
      .select('id')
      .eq('org_id', membership.org_id)
      .eq('slug', slug)
      .maybeSingle();
    if (existing) {
      slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    }

    // Find the Main workspace for this org to set as parent
    const { data: mainWs } = await supabase
      .from('workspaces')
      .select('id')
      .eq('org_id', membership.org_id)
      .eq('is_default', true)
      .maybeSingle();

    // Build insert payload — include repo fields if provided
    const insertPayload: Record<string, unknown> = {
      name: name.trim(),
      slug,
      icon: icon ?? null,
      org_id: membership.org_id,
      is_default: false,
      parent_workspace_id: mainWs?.id ?? null,
    };

    if (repo_url) {
      insertPayload.repo_url = repo_url;
      insertPayload.repo_provider = repo_provider ?? 'github';
      insertPayload.repo_path = repo_path ?? '/';
      insertPayload.repo_connected_at = new Date().toISOString();
    }
    if (github_default_branch) {
      insertPayload.github_default_branch = github_default_branch;
    }

    // Inherit github_installation_id from the main workspace
    if (mainWs) {
      const { data: mainWsData } = await supabase
        .from('workspaces')
        .select('github_installation_id')
        .eq('id', mainWs.id)
        .single();
      if (mainWsData?.github_installation_id) {
        insertPayload.github_installation_id = mainWsData.github_installation_id;
      }
    }

    const { data: workspace, error } = await supabase
      .from('workspaces')
      .insert(insertPayload)
      .select('id, name, slug, icon, is_default, created_at, parent_workspace_id')
      .single();

    if (error) return safeErrorResponse(error);

    // Auto-add creator as workspace member
    await supabase.from('workspace_memberships').insert({
      user_id: userId,
      workspace_id: workspace.id,
    });

    // Seed agents — either copy from default workspace or use plan-based templates
    try {
      // Check if org has "reuse agents across workspaces" enabled
      let reuseAgents = false;
      if (mainWs) {
        const { data: org } = await supabase
          .from('organizations')
          .select('metadata')
          .eq('id', membership.org_id)
          .single();
        reuseAgents =
          (org?.metadata as Record<string, unknown> | null)?.reuse_agents_across_workspaces ===
          true;
      }

      if (reuseAgents && mainWs) {
        // Copy agents from the default (main) workspace
        await copyAgentsFromWorkspace(mainWs.id, workspace.id, userId);
      } else {
        // Seed default agents based on the org's plan
        const { plan: planTier } = await resolveWorkspacePlan(workspace.id, userId);
        await seedDefaultAgents(workspace.id, planTier, userId);
      }
    } catch {
      // Non-fatal: workspace still created even if seeding fails
      console.error('[workspace-create] Agent seeding failed for workspace', workspace.id);
    }

    return NextResponse.json(workspace, { status: 201 });
  },
  {
    rateLimit: { tier: RATE_WRITE, routeKey: 'workspaces.post' },
    parseBody: createWorkspaceSchema,
  },
);
