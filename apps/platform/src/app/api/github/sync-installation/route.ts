/**
 * POST /api/github/sync-installation
 *
 * Assigns a github_installation_id to a workspace from the org's registered
 * installations (org_github_installations). Replaces the old sibling-inheritance
 * pattern with proper org-level installation lookup.
 *
 * Body: { workspace_id, installation_id? }
 *   - If installation_id provided: assign that specific org installation
 *   - If omitted and org has exactly one installation: auto-assign it
 *   - If omitted and org has multiple: return the list for user to pick
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';
import { getOrgInstallations, verifyOrgInstallation } from '@/lib/github-org';
import { githubSyncInstallationSchema } from '@/lib/schemas/github.schema';
import { validateOrigin } from '@/lib/csrf';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(
    request,
    'github.sync-installation.post',
    RATE_WRITE,
  );
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = githubSyncInstallationSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { workspace_id, installation_id } = parsed.data;

    const supabase = createServiceClient();

    const { data: membership } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!membership?.org_id) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, github_installation_id')
      .eq('id', workspace_id)
      .eq('org_id', membership.org_id)
      .single();

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    if (workspace.github_installation_id) {
      return NextResponse.json({ synced: false, reason: 'already_has_installation' });
    }

    // If a specific installation was requested, verify it belongs to this org
    if (installation_id) {
      const verified = await verifyOrgInstallation(supabase, membership.org_id, installation_id);
      if (!verified) {
        return NextResponse.json(
          { error: 'Installation not registered for this organization' },
          { status: 403 },
        );
      }

      await supabase
        .from('workspaces')
        .update({ github_installation_id: installation_id })
        .eq('id', workspace_id);

      return NextResponse.json({
        synced: true,
        installation_id,
        account: verified.github_account_login,
      });
    }

    // No specific installation — check org's registered installations
    const orgInstallations = await getOrgInstallations(supabase, membership.org_id);

    if (orgInstallations.length === 0) {
      return NextResponse.json({ synced: false, reason: 'no_org_installations' });
    }

    if (orgInstallations.length === 1) {
      // Auto-assign the single installation
      await supabase
        .from('workspaces')
        .update({ github_installation_id: orgInstallations[0].installation_id })
        .eq('id', workspace_id);

      return NextResponse.json({
        synced: true,
        installation_id: orgInstallations[0].installation_id,
        account: orgInstallations[0].github_account_login,
      });
    }

    // Multiple installations — return list for user to pick
    return NextResponse.json({
      synced: false,
      reason: 'multiple_installations',
      installations: orgInstallations,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
