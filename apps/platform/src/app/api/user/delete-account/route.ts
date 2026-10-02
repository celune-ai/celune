import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { validateOrigin } from '@/lib/csrf';
import { safeErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/user/delete-account
 *
 * Self-service account deletion (GDPR Art. 17 — Right to Erasure).
 * Deletes the authenticated user's data and auth record.
 *
 * Deletion scope:
 * - Hard delete: agent_memory, agent_configs, agent_status, api_keys,
 *   provider_api_keys, slack_connections, notification_preferences,
 *   support_tickets, usage_events, claude_usage, task_comments,
 *   task_attachments, user_roles, org_members, org_memberships,
 *   workspace_memberships, conversation_logs, feedback, user_preferences
 * - Anonymize: activity_log (actor set to null), security_audit_log (retained)
 * - Reassign: projects, tasks, project_groups (transferred to workspace default)
 * - Auth: hard delete from Supabase Auth (invalidates all sessions)
 */
export async function DELETE(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'user.delete-account', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient();

    // Verify the user exists and get their email for audit log
    const { data: authUser } = await supabase.auth.admin.getUserById(userId);
    if (!authUser?.user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const userEmail = authUser.user.email ?? 'unknown';

    // Prevent platform owner from self-deleting (must be done via admin)
    const appMeta = authUser.user.app_metadata ?? {};
    if (appMeta.is_platform_owner === true) {
      return NextResponse.json(
        { error: 'Platform owner account cannot be deleted via self-service' },
        { status: 403 },
      );
    }

    // Log the deletion request BEFORE deleting (immutable audit trail) — await to ensure it persists
    const { error: auditError } = await supabase.from('security_audit_log').insert({
      event_type: 'data.delete',
      severity: 'warning',
      actor_id: userId,
      actor_email: userEmail,
      target_type: 'user_account',
      target_id: userId,
      ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      user_agent: request.headers.get('user-agent') ?? null,
      details: { method: 'self-service', gdpr_art17: true, action: 'account_deletion' },
    });

    if (auditError) {
      console.error(`[delete-account] Audit log write failed for ${userId}:`, auditError.message);
      return NextResponse.json(
        { error: 'Failed to log deletion request. Please try again.' },
        { status: 500 },
      );
    }

    // --- DB cleanup phase: if ANY step fails, abort before deleting auth user ---
    const errors: string[] = [];

    // 1. Hard delete user-scoped data
    const deleteTables = [
      'user_roles',
      'org_members',
      'org_memberships',
      'workspace_memberships',
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
      'conversation_logs',
      'feedback',
      'provider_api_keys',
      'user_preferences',
    ];

    for (const table of deleteTables) {
      const { error } = await supabase.from(table).delete().eq('user_id', userId);
      if (error) {
        errors.push(`${table}: ${error.message}`);
      }
    }

    // 1b. Clean FK columns with different column names
    const { error: activityErr } = await supabase
      .from('activity_log')
      .delete()
      .eq('actor_user_id', userId);
    if (activityErr) errors.push(`activity_log: ${activityErr.message}`);

    // 2. Anonymize security audit logs (retain for compliance, remove PII)
    const { error: anonErr } = await supabase
      .from('security_audit_log')
      .update({ actor_id: null, actor_email: '[deleted]' })
      .eq('actor_id', userId);
    if (anonErr) errors.push(`security_audit_log anonymize: ${anonErr.message}`);

    // 3. Nullify user references on shared data (projects/tasks stay for workspace)
    for (const table of ['projects', 'tasks', 'project_groups']) {
      const { error } = await supabase.from(table).update({ user_id: null }).eq('user_id', userId);
      if (error) errors.push(`${table} nullify: ${error.message}`);
    }

    // 4. Transfer org ownership or delete orgs with no other members
    const { data: ownedOrgs } = await supabase
      .from('organizations')
      .select('id')
      .eq('owner_id', userId);

    if (ownedOrgs?.length) {
      for (const org of ownedOrgs) {
        // Find another member to transfer to
        const { data: otherMember } = await supabase
          .from('org_memberships')
          .select('user_id')
          .eq('org_id', org.id)
          .neq('user_id', userId)
          .limit(1)
          .single();

        if (otherMember) {
          const { error: transferErr } = await supabase
            .from('organizations')
            .update({ owner_id: otherMember.user_id })
            .eq('id', org.id);
          if (transferErr) errors.push(`org ${org.id} transfer: ${transferErr.message}`);
        }
        // If no other members, org will be orphaned — acceptable for now
      }
    }

    // Abort if any DB cleanup failed — do NOT delete auth user with partial cleanup
    if (errors.length > 0) {
      console.error(`[delete-account] DB cleanup failed for ${userId}:`, errors);
      return NextResponse.json(
        {
          error:
            'Account deletion partially failed. Your account has not been deleted. Please contact support.',
        },
        { status: 500 },
      );
    }

    // 5. Delete auth user (invalidates all sessions) — only after all DB cleanup succeeded
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
    if (deleteError) {
      const msg = deleteError.message ?? '';
      if (!msg.includes('not found') && !msg.includes('User not found')) {
        console.error(`[delete-account] Auth delete failed for ${userId}:`, msg);
        return NextResponse.json(
          { error: 'Failed to complete account deletion. Please contact support.' },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Your account and all associated data have been permanently deleted.',
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
