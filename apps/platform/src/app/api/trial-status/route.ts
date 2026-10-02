/**
 * GET /api/trial-status?workspace_id=...
 *
 * Returns the starter token budget for a workspace: the shared host model key it
 * uses before adding its own. The route and field names keep "trial" for existing
 * clients; this is not a billing trial (Cloud has none).
 * Used by the provider key banner to show usage and the BYOK prompt.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { RATE_READ } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';

export const dynamic = 'force-dynamic';

export const GET = withApiSecurity(
  async (request: NextRequest, { userId }: SecurityContext) => {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json(
        { error: 'workspace_id query parameter is required' },
        { status: 400 },
      );
    }

    const supabase = createServiceClient();

    // Verify membership
    const { data: membership } = await supabase
      .from('workspace_memberships')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get trial budget + org_id in one query
    const { data: ws } = await supabase
      .from('workspaces')
      .select('trial_token_budget, trial_tokens_used, org_id')
      .eq('id', workspaceId)
      .single();

    const budget = ws?.trial_token_budget ?? 50000;
    const used = ws?.trial_tokens_used ?? 0;
    const remaining = Math.max(0, budget - used);
    const exhausted = used >= budget;
    const orgId = ws?.org_id;

    // Check if user has any active provider keys scoped to their org
    let keyCount = 0;
    if (orgId) {
      const res = await supabase
        .from('provider_api_keys')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('is_active', true);
      keyCount = res.count ?? 0;
    }

    const hasProviderKey = (keyCount ?? 0) > 0;

    return NextResponse.json({
      trial_token_budget: budget,
      trial_tokens_used: used,
      trial_tokens_remaining: remaining,
      trial_exhausted: exhausted,
      trial_percent_used: budget > 0 ? Math.round((used / budget) * 100) : 100,
      has_provider_key: hasProviderKey,
      requires_key: exhausted && !hasProviderKey,
    });
  },
  {
    rateLimit: { tier: RATE_READ, routeKey: 'trial-status.get' },
    csrf: false,
  },
);
