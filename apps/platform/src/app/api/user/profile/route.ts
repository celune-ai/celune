import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { updateProfileSchema } from '@/lib/schemas/common.schema';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

// GET /api/user/profile — returns current user's metadata + role
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Service client: fetch role bypassing RLS to avoid silent query failures. Accesses: user_roles.
    const service = createServiceClient();

    // Fetch role from user_roles table
    const { data: roleRow } = await service
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    // Fallback: check org_members.is_owner for users without a user_roles entry
    let role = roleRow?.role ?? 'member';
    if (!roleRow) {
      const { data: orgOwner } = await service
        .from('org_members')
        .select('is_owner')
        .eq('user_id', user.id)
        .eq('is_owner', true)
        .maybeSingle();
      if (orgOwner) role = 'owner';
    }

    return NextResponse.json({
      id: user.id,
      email: user.email,
      first_name: (user.user_metadata?.first_name as string | undefined) ?? null,
      display_name: (user.user_metadata?.display_name as string | undefined) ?? null,
      avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null,
      role,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

// PATCH /api/user/profile — updates display_name and/or avatar_url in user_metadata
type UpdateProfileBody = z.infer<typeof updateProfileSchema>;

export const PATCH = withApiSecurity<UpdateProfileBody>(
  async (_request: NextRequest, { userId, body }: SecurityContext<UpdateProfileBody>) => {
    // Service client: update user metadata by ID. Accesses: auth.users.
    const supabase = createServiceClient();

    const { first_name, display_name, avatar_url, org_name } = body;

    const metadata: Record<string, string> = {};
    if (first_name !== undefined) metadata.first_name = first_name;
    if (display_name !== undefined) metadata.display_name = display_name;
    if (avatar_url !== undefined) metadata.avatar_url = avatar_url;

    // Update org name if provided (resolves user's org via membership)
    if (org_name !== undefined && org_name.trim()) {
      const { data: membership } = await supabase
        .from('org_memberships')
        .select('org_id, is_owner')
        .eq('user_id', userId)
        .limit(1)
        .single();

      if (membership?.org_id) {
        await supabase
          .from('organizations')
          .update({ name: org_name.trim(), updated_at: new Date().toISOString() })
          .eq('id', membership.org_id);
      }
    }

    if (Object.keys(metadata).length === 0 && !org_name) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    let userResult = null;
    if (Object.keys(metadata).length > 0) {
      const { data, error } = await supabase.auth.admin.updateUserById(userId, {
        user_metadata: metadata,
      });
      if (error) throw error;
      userResult = data.user;
    } else {
      // org_name-only update — fetch current user metadata to return
      const { data } = await supabase.auth.admin.getUserById(userId);
      userResult = data.user;
    }

    return NextResponse.json({
      first_name: (userResult?.user_metadata?.first_name as string | undefined) ?? null,
      display_name: (userResult?.user_metadata?.display_name as string | undefined) ?? null,
      avatar_url: (userResult?.user_metadata?.avatar_url as string | undefined) ?? null,
    });
  },
  {
    rateLimit: { tier: RATE_WRITE, routeKey: 'user.profile.patch' },
    parseBody: updateProfileSchema,
  },
);
