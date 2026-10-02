import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { createActivity } from '@repo/db/queries';
import { canManageRoleV2 } from '@/lib/roles';
import { z } from 'zod';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import { sendAgentReport } from '@repo/agentmail';
import { renderInvitation } from '@repo/notifications';
import { APP_URL } from '@/lib/branding';
import { syncSeats } from '@/lib/billing-seats';
const inviteSchema = z
  .object({
    email: z.string().email().max(320),
    role: z.enum(['admin', 'member', 'viewer']).default('member'),
    role_id: z.string().uuid().optional(),
    workspace_id: z.string().uuid().optional(),
  })
  .strip();

export const dynamic = 'force-dynamic';

type InviteBody = z.infer<typeof inviteSchema>;

export const POST = withApiSecurity<InviteBody>(
  async (
    request: NextRequest,
    { userId, body, permissionContext }: SecurityContext<InviteBody>,
  ) => {
    // Prevent escalation: caller can only invite roles below their own level
    const invitedRole = body.role ?? 'member';
    if (!canManageRoleV2(permissionContext!.resolved, invitedRole)) {
      return NextResponse.json(
        { error: `Cannot invite a user with role "${body.role}" — insufficient privileges` },
        { status: 403 },
      );
    }

    // Service client: uses admin auth API to invite users and writes role/membership records. Accesses: auth.users (admin API), user_roles, roles, org_members, workspace_memberships, activity_log.
    const supabase = createServiceClient();

    // The invitee joins the org of the workspace the permission was checked on.
    // Only the platform owner passes that check without a workspace; it then uses
    // an org the platform owner owns.
    const workspaceId =
      request.nextUrl.searchParams.get('workspace_id') ?? body.workspace_id ?? null;
    let targetOrgId: string | null = null;
    if (workspaceId) {
      const { data: ws } = await supabase
        .from('workspaces')
        .select('org_id')
        .eq('id', workspaceId)
        .maybeSingle();
      targetOrgId = ws?.org_id ?? null;
    } else {
      const { data: ownOrg } = await supabase
        .from('org_members')
        .select('org_id')
        .eq('user_id', userId)
        .eq('is_owner', true)
        .limit(1)
        .maybeSingle();
      targetOrgId = ownOrg?.org_id ?? null;
    }
    if (!targetOrgId) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }

    // A custom role must belong to the target org (or be a system role) and sit
    // below the caller, like the role slug checked above.
    let customRoleId: string | undefined;
    if (body.role_id) {
      const { data: custom } = await supabase
        .from('roles')
        .select('id, slug, org_id, is_system')
        .eq('id', body.role_id)
        .maybeSingle();
      const usable =
        custom &&
        (custom.org_id === targetOrgId || (custom.is_system && custom.org_id === null)) &&
        canManageRoleV2(permissionContext!.resolved, custom.slug);
      if (!usable) {
        return NextResponse.json({ error: 'Invalid role_id' }, { status: 400 });
      }
      customRoleId = custom.id;
    }

    const { data, error } = await supabase.auth.admin.inviteUserByEmail(body.email, {
      data: { invited_role: body.role },
    });

    if (error) {
      if (error.message?.includes('already been registered')) {
        return NextResponse.json({ error: 'This email is already registered' }, { status: 409 });
      }
      throw error;
    }

    // Insert role for the invited user (legacy user_roles + new org_members)
    if (data.user) {
      await supabase
        .from('user_roles')
        .upsert({ user_id: data.user.id, role: body.role }, { onConflict: 'user_id' });

      // Dual-write: sync org_members during migration
      try {
        // Resolve role_id: use explicit role_id if provided, otherwise look up by slug
        let resolvedRoleId = customRoleId;
        if (!resolvedRoleId) {
          const { data: roleRow } = await supabase
            .from('roles')
            .select('id')
            .eq('slug', invitedRole)
            .eq('is_system', true)
            .single();
          resolvedRoleId = roleRow?.id;
        }

        if (resolvedRoleId) {
          if (targetOrgId) {
            await supabase.from('org_members').upsert(
              {
                user_id: data.user.id,
                org_id: targetOrgId,
                role_id: resolvedRoleId,
                is_owner: false,
                is_active: true,
              },
              { onConflict: 'user_id,org_id' },
            );
            await syncSeats(targetOrgId);

            // If a workspace is specified, create workspace membership too
            if (workspaceId) {
              await supabase.from('workspace_memberships').upsert(
                {
                  user_id: data.user.id,
                  workspace_id: workspaceId,
                  role_id: resolvedRoleId,
                },
                { onConflict: 'user_id,workspace_id' },
              );
            }
          }
        }
      } catch {
        // org_members sync is best-effort during migration
      }
    }

    await createActivity(supabase, {
      event_type: 'user.invited',
      severity: 'info',
      source: 'web',
      title: `User invited: ${body.email} as ${body.role}`,
      actor_user_id: userId,
      details: {
        role_id: body.role_id ?? null,
        workspace_id: workspaceId,
      },
    });

    // Send branded invitation email via AgentMail (best-effort)
    try {
      // Resolve inviter name
      const { data: inviterRecord } = await supabase.auth.admin.getUserById(userId);
      const inviterName =
        inviterRecord.user?.user_metadata?.full_name ??
        inviterRecord.user?.user_metadata?.firstName ??
        inviterRecord.user?.email ??
        'A team member';

      // Resolve workspace name
      let workspaceName = 'your workspace';
      if (workspaceId) {
        const { data: ws } = await supabase
          .from('workspaces')
          .select('name')
          .eq('id', workspaceId)
          .single();
        if (ws?.name) workspaceName = ws.name;
      }

      // Build accept URL from the Supabase invitation
      const acceptUrl = data.user?.confirmation_sent_at ? `${APP_URL}/auth/confirm` : APP_URL;

      const invitation = renderInvitation({
        workspace_name: workspaceName,
        inviter_name: inviterName,
        role: invitedRole,
        accept_url: acceptUrl,
      });

      await sendAgentReport({
        from: 'sage',
        to: body.email,
        subject: invitation.subject,
        markdown: invitation.markdown,
        html: invitation.html,
      });
    } catch {
      // Invitation email is best-effort — don't fail the request
    }

    return NextResponse.json(
      { message: `Invitation sent to ${body.email}`, user_id: data.user?.id },
      { status: 201 },
    );
  },
  {
    permission: 'users:invite',
    rateLimit: { tier: RATE_WRITE, routeKey: 'user.invite.post' },
    parseBody: inviteSchema,
  },
);
