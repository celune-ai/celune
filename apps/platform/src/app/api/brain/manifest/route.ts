/**
 * Brain manifest listing endpoint.
 *
 * GET /api/brain/manifest?workspace_id=<id>
 *
 * Returns all brain_manifest entries for a workspace, used by the
 * skill library page to display installed skills, hooks, and agents.
 * Includes section-level update counts per manifest entry.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { safeErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const rl = await applyRateLimit(request, 'brain.manifest', RATE_READ);
  if (rl) return rl.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json(
        { error: 'workspace_id query parameter is required' },
        { status: 400 },
      );
    }
    if (!isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }

    // Verify the user is a member of this workspace
    const forbidden = await requireWorkspaceMembership(userId, workspaceId);
    if (forbidden) return forbidden;

    // Service client: reads all brain_manifest rows for a workspace. Accesses: brain_manifest, brain_section_hashes.
    const supabase = createServiceClient();

    const manifestSelect =
      'id, path, version, tier, category, is_core, is_forked, forked_at, update_available, update_summary, created_at, updated_at';

    // Fetch workspace's manifest entries
    const { data, error } = await supabase
      .from('brain_manifest')
      .select(manifestSelect)
      .eq('workspace_id', workspaceId)
      .order('category')
      .order('path');

    if (error) {
      console.error('[brain-manifest] Query error:', error);
      return NextResponse.json({ error: 'Failed to load manifest' }, { status: 500 });
    }

    const manifestData = data ?? [];

    // Enrich each manifest entry with section-level update count
    let enrichedData = manifestData.map((entry) => ({
      ...entry,
      section_update_count: 0,
    }));

    try {
      // Fetch section update counts for all manifest entries in this workspace
      const manifestIds = manifestData.map((entry) => entry.id);
      if (manifestIds.length > 0) {
        const { data: sectionRows } = await supabase
          .from('brain_section_hashes')
          .select('manifest_id, update_available')
          .in('manifest_id', manifestIds);

        if (sectionRows && sectionRows.length > 0) {
          // Count sections with updates per manifest entry
          const updateCountByManifestId = new Map<string, number>();
          for (const row of sectionRows) {
            if (row.update_available) {
              updateCountByManifestId.set(
                row.manifest_id,
                (updateCountByManifestId.get(row.manifest_id) ?? 0) + 1,
              );
            }
          }

          enrichedData = enrichedData.map((entry) => ({
            ...entry,
            section_update_count: updateCountByManifestId.get(entry.id) ?? 0,
          }));
        }
      }
    } catch {
      // brain_section_hashes table may not exist — degrade gracefully
      // enrichedData already has section_update_count: 0 as default
    }

    return NextResponse.json(
      { data: enrichedData },
      {
        headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=30' },
      },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
