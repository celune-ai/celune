import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';
import { orgSettingsSchema } from '@/lib/schemas/org.schema';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import { isFeatureAvailable } from '@/lib/plan-enforcement';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

/**
 * GET /api/org/settings
 * Returns the organization metadata for the authenticated user's org.
 * Only accessible by org owners.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const supabase = createServiceClient();

    // Get user's org membership and verify owner status
    const { data: membership, error: membershipError } = await supabase
      .from('org_memberships')
      .select('org_id, role')
      .eq('user_id', userId)
      .limit(1)
      .single();

    if (membershipError || !membership?.org_id) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    if (membership.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only org owners can access org settings' },
        { status: 403 },
      );
    }

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, metadata')
      .eq('id', membership.org_id)
      .single();

    if (orgError || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const metadata = (org.metadata as Record<string, unknown> | null) ?? {};

    return NextResponse.json({
      org_id: org.id,
      reuse_agents_across_workspaces: metadata.reuse_agents_across_workspaces === true,
      sharing_enabled: metadata.sharing_enabled === true,
      auto_open_urls: metadata.auto_open_urls !== false,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * PUT /api/org/settings
 * Updates organization metadata settings.
 * Only accessible by org owners.
 */
type OrgSettingsBody = z.infer<typeof orgSettingsSchema>;

export const PUT = withApiSecurity<OrgSettingsBody>(
  async (_request: NextRequest, { userId, body }: SecurityContext<OrgSettingsBody>) => {
    const supabase = createServiceClient();

    const { reuse_agents_across_workspaces } = body;

    // Get user's org membership and verify owner status
    const { data: membership, error: membershipError } = await supabase
      .from('org_memberships')
      .select('org_id, role')
      .eq('user_id', userId)
      .limit(1)
      .single();

    if (membershipError || !membership?.org_id) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    if (membership.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only org owners can update org settings' },
        { status: 403 },
      );
    }

    // Fetch current metadata to merge
    const { data: org } = await supabase
      .from('organizations')
      .select('metadata')
      .eq('id', membership.org_id)
      .single();

    const currentMetadata = (org?.metadata as Record<string, unknown> | null) ?? {};
    const updatedMetadata = { ...currentMetadata };

    if (reuse_agents_across_workspaces !== undefined) {
      updatedMetadata.reuse_agents_across_workspaces = reuse_agents_across_workspaces;
    }
    if (body.auto_open_urls !== undefined) {
      updatedMetadata.auto_open_urls = body.auto_open_urls;
    }
    if (body.sharing_enabled !== undefined) {
      // Plan gate: brain_sharing requires Team+ plan
      if (body.sharing_enabled) {
        // Resolve default workspace for the org to check plan
        const { data: defaultWs } = await supabase
          .from('workspaces')
          .select('id')
          .eq('org_id', membership.org_id)
          .eq('is_default', true)
          .limit(1)
          .single();

        if (defaultWs) {
          const allowed = await isFeatureAvailable(defaultWs.id, 'brain_sharing');
          if (!allowed) {
            return NextResponse.json(
              {
                error: 'plan_limit',
                message: 'Cross-workspace brain sharing requires a Team plan or higher.',
                upgrade_url: '/settings?tab=billing',
              },
              { status: 403 },
            );
          }
        }
      }
      updatedMetadata.sharing_enabled = body.sharing_enabled;
    }

    const { error: updateError } = await supabase
      .from('organizations')
      .update({ metadata: updatedMetadata, updated_at: new Date().toISOString() })
      .eq('id', membership.org_id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      org_id: membership.org_id,
      reuse_agents_across_workspaces: updatedMetadata.reuse_agents_across_workspaces === true,
      sharing_enabled: updatedMetadata.sharing_enabled === true,
      auto_open_urls: updatedMetadata.auto_open_urls !== false,
    });
  },
  {
    rateLimit: { tier: RATE_WRITE, routeKey: 'org.settings.put' },
    parseBody: orgSettingsSchema,
  },
);
