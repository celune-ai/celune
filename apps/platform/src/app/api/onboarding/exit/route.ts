/**
 * POST /api/onboarding/exit
 *
 * Deletes all organization, workspace, and membership data for the current user.
 * Keeps the auth.users record intact so they remain a "marketing user" who can
 * sign up again later. Signs them out after cleanup.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { safeErrorResponse } from '@/lib/api-error';
import { orgIdsForUser, syncSeats } from '@/lib/billing-seats';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'onboarding.exit', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient();

    // Find orgs owned by this user
    const { data: orgs } = await supabase.from('organizations').select('id').eq('owner_id', userId);

    const orgIds = (orgs ?? []).map((o) => o.id);
    // Orgs the user belongs to, read before the memberships go, for Cloud seat sync
    const memberOrgIds = await orgIdsForUser(userId);

    if (orgIds.length > 0) {
      // Find all workspaces under these orgs
      const { data: workspaces } = await supabase
        .from('workspaces')
        .select('id')
        .in('org_id', orgIds);

      const wsIds = (workspaces ?? []).map((w) => w.id);

      // Delete workspace-scoped data
      if (wsIds.length > 0) {
        await Promise.all([
          supabase.from('task_comments').delete().in('workspace_id', wsIds),
          supabase.from('project_prs').delete().in('workspace_id', wsIds),
          supabase.from('brain_manifest').delete().in('workspace_id', wsIds),
          supabase.from('usage_summaries').delete().in('workspace_id', wsIds),
          supabase.from('changelog_entries').delete().in('workspace_id', wsIds),
          supabase.from('slack_connections').delete().in('workspace_id', wsIds),
          supabase.from('webhook_endpoints').delete().in('workspace_id', wsIds),
          supabase.from('workspace_invitations').delete().in('workspace_id', wsIds),
          supabase.from('workspace_github_tokens').delete().in('workspace_id', wsIds),
          supabase.from('portfolio_passwords').delete().in('workspace_id', wsIds),
          supabase.from('dot_voter_rooms').delete().in('workspace_id', wsIds),
        ]);
      }

      // Delete user-scoped data
      await Promise.all([
        supabase.from('task_attachments').delete().eq('user_id', userId),
        supabase.from('tasks').delete().eq('user_id', userId),
        supabase.from('projects').delete().eq('user_id', userId),
        supabase.from('project_groups').delete().eq('user_id', userId),
        supabase.from('activity_log').delete().eq('user_id', userId),
        supabase.from('agent_memory').delete().eq('user_id', userId),
        supabase.from('agent_configs').delete().eq('user_id', userId),
        supabase.from('agent_status').delete().eq('user_id', userId),
        supabase.from('conversation_logs').delete().eq('user_id', userId),
        supabase.from('claude_usage').delete().eq('user_id', userId),
        supabase.from('usage_events').delete().eq('user_id', userId),
        supabase.from('feedback').delete().eq('user_id', userId),
        supabase.from('support_tickets').delete().eq('user_id', userId),
        supabase.from('provider_api_keys').delete().eq('user_id', userId),
        supabase.from('api_keys').delete().eq('user_id', userId),
        supabase.from('notification_preferences').delete().eq('user_id', userId),
        supabase.from('user_preferences').delete().eq('user_id', userId),
      ]);

      // Delete memberships
      await Promise.all([
        supabase.from('workspace_memberships').delete().eq('user_id', userId),
        supabase.from('user_roles').delete().eq('user_id', userId),
        supabase.from('org_memberships').delete().eq('user_id', userId),
        supabase.from('org_members').delete().eq('user_id', userId),
      ]);
      await syncSeats(memberOrgIds.filter((id) => !orgIds.includes(id)));

      // Delete org-level data
      for (const orgId of orgIds) {
        await Promise.all([
          supabase.from('org_github_installations').delete().eq('org_id', orgId),
          supabase.from('org_permission_overrides').delete().eq('org_id', orgId),
          supabase.from('org_shared_agents').delete().eq('org_id', orgId),
          supabase.from('roles').delete().eq('org_id', orgId),
        ]);
      }

      // Delete structural data: workspaces → orgs
      if (wsIds.length > 0) {
        await supabase.from('workspaces').delete().in('id', wsIds);
      }
      await supabase.from('organizations').delete().in('id', orgIds);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
