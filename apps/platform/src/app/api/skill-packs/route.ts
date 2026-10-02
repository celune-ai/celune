/**
 * Skill Packs browse endpoint.
 *
 * GET /api/skill-packs?category=<cat>&tier=<tier>&workspace_id=<id>
 *
 * Returns published skill packs. If workspace_id is provided, includes
 * installation status for each pack.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { safeErrorResponse } from '@/lib/api-error';
import type { SkillPackCategory, SkillPackMinPlan } from '@repo/types';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const rl = await applyRateLimit(request, 'skill-packs', RATE_READ);
  if (rl) return rl.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const category = request.nextUrl.searchParams.get('category') as SkillPackCategory | null;
    const tier = request.nextUrl.searchParams.get('tier') as SkillPackMinPlan | null;
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    const teamType = request.nextUrl.searchParams.get('team_type');

    // If workspace_id provided, verify membership
    if (workspaceId) {
      if (!isValidUuid(workspaceId)) {
        return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
      }
      const forbidden = await requireWorkspaceMembership(userId, workspaceId);
      if (forbidden) return forbidden;
    }

    // Service client: reads skill_packs and optionally skill_pack_installs. Accesses: skill_packs, skill_pack_installs.
    const supabase = createServiceClient();

    let query = supabase
      .from('skill_packs')
      .select(
        'id, slug, name, description, icon, pack_category, min_tier, version, skill_entries, team_type_affinity, install_count, is_published, created_at, updated_at',
      )
      .eq('is_published', true)
      .order('name');

    if (category) {
      query = query.eq('pack_category', category);
    }
    if (tier) {
      query = query.eq('min_tier', tier);
    }

    const { data: packs, error } = await query;

    if (error) {
      console.error('[skill-packs] Query error:', error);
      return NextResponse.json({ error: 'Failed to load skill packs' }, { status: 500 });
    }

    let packsData = (packs ?? []).map((pack) => ({
      ...pack,
      installed: false,
      installed_at: null as string | null,
    }));

    // Sort by team_type_affinity if team_type provided
    if (teamType) {
      packsData.sort((a, b) => {
        const affinityA = (a.team_type_affinity as Record<string, number>)?.[teamType] ?? 99;
        const affinityB = (b.team_type_affinity as Record<string, number>)?.[teamType] ?? 99;
        return affinityA - affinityB;
      });
    }

    // Enrich with installation status if workspace_id provided
    if (workspaceId) {
      const packIds = packsData.map((p) => p.id);
      if (packIds.length > 0) {
        const { data: installs } = await supabase
          .from('skill_pack_installs')
          .select('skill_pack_id, installed_at')
          .eq('workspace_id', workspaceId)
          .in('skill_pack_id', packIds);

        if (installs && installs.length > 0) {
          const installMap = new Map(installs.map((i) => [i.skill_pack_id, i.installed_at]));
          packsData = packsData.map((pack) => ({
            ...pack,
            installed: installMap.has(pack.id),
            installed_at: installMap.get(pack.id) ?? null,
          }));
        }
      }
    }

    return NextResponse.json({ data: packsData });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
