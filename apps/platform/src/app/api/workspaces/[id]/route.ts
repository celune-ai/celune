import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { updateWorkspaceSchema } from '@/lib/schemas/workspace.schema';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 });
    }
    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const membershipError = await requireWorkspaceMembership(userId, id);
    if (membershipError) return membershipError;

    const supabase = createServiceClient();

    const { data: workspace, error } = await supabase
      .from('workspaces')
      .select(
        'id, name, slug, icon, is_default, created_at, repo_url, repo_provider, github_installation_id',
      )
      .eq('id', id)
      .single();

    if (error || !workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    // If there's a github installation, fetch account info from org_github_installations
    let github_account_login: string | null = null;
    let github_account_avatar_url: string | null = null;
    if (workspace.github_installation_id) {
      const { data: inst } = await supabase
        .from('org_github_installations')
        .select('github_account_login, github_account_avatar_url')
        .eq('installation_id', workspace.github_installation_id)
        .limit(1)
        .single();
      if (inst) {
        github_account_login = inst.github_account_login;
        github_account_avatar_url = inst.github_account_avatar_url;
      }
    }

    return NextResponse.json({ ...workspace, github_account_login, github_account_avatar_url });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'workspaces.id.put', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 });
    }
    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createServiceClient();

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = updateWorkspaceSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const body = parsed.data;
    const { name, icon, description, metadata, repo_url, github_installation_id } = body;

    // Verify workspace belongs to user's org and check role
    const { data: membership } = await supabase
      .from('org_memberships')
      .select('org_id, role')
      .eq('user_id', userId)
      .limit(1)
      .single();
    if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, org_id')
      .eq('id', id)
      .eq('org_id', membership.org_id)
      .single();
    if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    const updates: Record<string, unknown> = {};
    if (name && typeof name === 'string' && name.trim().length >= 2) updates.name = name.trim();
    if (icon !== undefined) updates.icon = icon;
    if (description !== undefined)
      updates.description = typeof description === 'string' ? description.trim() : null;
    if (metadata !== undefined && typeof metadata === 'object' && metadata !== null)
      updates.metadata = metadata;

    // GitHub installation: only org owners can modify
    if (github_installation_id !== undefined) {
      if (membership.role !== 'owner') {
        return NextResponse.json(
          { error: 'Only organization owners can modify GitHub connection' },
          { status: 403 },
        );
      }
      updates.github_installation_id = github_installation_id;
    }

    // GitHub settings: merge partial updates into existing settings (allowlisted keys only)
    if (body.github_settings !== undefined) {
      if (typeof body.github_settings !== 'object' || body.github_settings === null) {
        return NextResponse.json({ error: 'github_settings must be an object' }, { status: 400 });
      }

      const allowedSettingsKeys = new Set([
        'pr_strategy',
        'auto_pr',
        'branch_naming',
        'default_reviewers',
        'rebase_threshold_commits',
        'stale_pr_warning_days',
        'agent_code_context',
        'auto_sync_on_push',
        'webhook_events',
      ]);
      const allowedBranchKeys = new Set(['prefix', 'separator', 'include_assignee', 'slug_source']);

      // Filter to allowed keys only
      const safeSettings: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body.github_settings)) {
        if (allowedSettingsKeys.has(key)) safeSettings[key] = value;
      }

      // Fetch existing settings to merge
      const { data: current } = await supabase
        .from('workspaces')
        .select('github_settings')
        .eq('id', id)
        .single();
      const existing = (current?.github_settings as Record<string, unknown>) ?? {};
      const mergedSettings = { ...existing, ...safeSettings };

      // Deep merge branch_naming with allowlisted keys
      if (safeSettings.branch_naming && typeof safeSettings.branch_naming === 'object') {
        const existingBranch = (existing.branch_naming as Record<string, unknown>) ?? {};
        const safeBranch: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(
          safeSettings.branch_naming as Record<string, unknown>,
        )) {
          if (allowedBranchKeys.has(key)) safeBranch[key] = value;
        }
        mergedSettings.branch_naming = { ...existingBranch, ...safeBranch };
      }

      updates.github_settings = mergedSettings;
    }

    // Repo disconnect: allow setting repo_url to null to clear the connection
    if (repo_url !== undefined) {
      updates.repo_url = repo_url;
      if (repo_url === null) {
        updates.repo_provider = 'github';
        updates.repo_path = null;
        updates.repo_connected_at = null;
        updates.github_default_branch = null;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { data: updated, error } = await supabase
      .from('workspaces')
      .update(updates)
      .eq('id', id)
      .select('id, name, slug, icon, is_default, created_at')
      .single();

    if (error) return safeErrorResponse(error);
    return NextResponse.json(updated);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResult = await applyRateLimit(request, 'workspaces.id.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 });
    }
    const userId = getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createServiceClient();

    // Verify workspace belongs to user's org
    const { data: membership } = await supabase
      .from('org_memberships')
      .select('org_id, is_owner')
      .eq('user_id', userId)
      .limit(1)
      .single();
    if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, org_id, is_default')
      .eq('id', id)
      .eq('org_id', membership.org_id)
      .single();
    if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    if (workspace.is_default) {
      return NextResponse.json(
        { error: 'Cannot delete the main organization workspace' },
        { status: 400 },
      );
    }

    // Delete dependent data before the workspace itself
    await supabase.from('tasks').delete().eq('workspace_id', id);
    await supabase.from('projects').delete().eq('workspace_id', id);
    await supabase.from('agent_memory').delete().eq('workspace_id', id);
    await supabase.from('workspace_memberships').delete().eq('workspace_id', id);
    const { error } = await supabase.from('workspaces').delete().eq('id', id);
    if (error) return safeErrorResponse(error);

    return NextResponse.json({ success: true });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
