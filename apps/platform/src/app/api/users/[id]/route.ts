import { type NextRequest, NextResponse } from 'next/server';
import { isValidUuid } from '@repo/db/validation';
import { validateOrigin } from '@/lib/csrf';
import { safeErrorResponse } from '@/lib/api-error';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { canManageRoleV2 } from '@/lib/roles';
import { removeFromOrgs, requireUserScope } from '@/lib/user-management-scope';
import { orgIdsForUser, syncSeats } from '@/lib/billing-seats';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/users/[id]
 *
 * Org admins (users:manage in an org they share with the user) remove the user
 * from those orgs. The platform owner permanently deletes the account: auth user,
 * user_roles row, and owned data. The email can sign up again afterward.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResult = await applyRateLimit(request, 'users.id.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  try {
    const { id: targetUserId } = await params;

    // Validate UUID format before any database calls
    if (!isValidUuid(targetUserId)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    const scope = await requireUserScope(request, targetUserId, 'users:manage');
    if (scope instanceof NextResponse) return scope;
    const { callerId, supabase } = scope;

    // Prevent self-deletion
    if (targetUserId === callerId) {
      return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
    }

    // An org admin removes the user from the orgs they manage; the account and the
    // user's other orgs stay. Only the platform owner deletes the account itself.
    if (!scope.platformOwner) {
      for (const org of scope.orgs) {
        if (org.targetIsOwner) {
          return NextResponse.json(
            { error: 'Cannot remove the organization owner' },
            { status: 403 },
          );
        }
        if (!canManageRoleV2(org.resolved, org.targetRole ?? '')) {
          return NextResponse.json(
            { error: 'You do not have permission to manage this user' },
            { status: 403 },
          );
        }
      }
      await removeFromOrgs(
        supabase,
        targetUserId,
        scope.orgs.map((org) => org.orgId),
      );
      return NextResponse.json({ success: true, message: 'User removed from the organization.' });
    }

    // Check the target user's current role — the platform owner account cannot be deleted
    const { data: targetRole } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', targetUserId)
      .single();

    if (targetRole?.role === 'owner') {
      return NextResponse.json({ error: 'Cannot delete the owner account' }, { status: 403 });
    }

    // Read the user's orgs before the memberships go, so their seats can be synced after.
    const memberOrgIds = await orgIdsForUser(targetUserId);

    // Clean up ALL foreign-key references to auth.users before deleting the auth user.
    // Supabase auth.admin.deleteUser will fail if any FK rows still point to the user.

    // 1. Delete rows entirely (ephemeral or user-scoped data)
    const deleteTables = [
      'user_roles',
      'org_members',
      'org_memberships',
      'workspace_memberships',
      'activity_log',
      'task_comments',
      'task_attachments',
      'api_keys',
      'agent_configs',
      'agent_memory',
      'agent_status',
      'notification_preferences',
      'usage_events',
      'claude_usage',
      'support_tickets',
      'slack_connections',
    ];
    for (const table of deleteTables) {
      const { error } = await supabase.from(table).delete().eq('user_id', targetUserId);
      if (error) {
        console.warn(`[delete-user] Failed to clean ${table} for ${targetUserId}:`, error.message);
      }
    }

    // 1b. Clean FK columns that use a different column name than user_id
    await supabase.from('activity_log').delete().eq('actor_user_id', targetUserId);
    await supabase.from('slack_connections').delete().eq('connected_by', targetUserId);

    // 2. Reassign ownership so data isn't orphaned (projects/tasks/groups stay visible)
    for (const table of ['projects', 'tasks', 'project_groups']) {
      await supabase.from(table).update({ user_id: callerId }).eq('user_id', targetUserId);
    }

    // 3. Transfer org ownership to caller if user owns any orgs (prevents FK block)
    await supabase
      .from('organizations')
      .update({ owner_id: callerId })
      .eq('owner_id', targetUserId);

    await syncSeats(memberOrgIds);

    // Hard-delete the auth user from Supabase Auth.
    // This invalidates all sessions and prevents login with old credentials.
    const { error: deleteError } = await supabase.auth.admin.deleteUser(targetUserId);

    if (deleteError) {
      const msg = deleteError.message ?? '';
      // User not found in auth is fine — data cleanup was the main goal
      if (msg.includes('not found') || msg.includes('User not found')) {
        console.warn(`[delete-user] Auth user ${targetUserId} not found — data cleanup completed.`);
      } else {
        console.error(`[delete-user] Auth delete failed for ${targetUserId}:`, msg);
        return NextResponse.json(
          { error: `Failed to delete user from auth: ${msg}` },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: 'User permanently deleted. Email can sign up again.',
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
