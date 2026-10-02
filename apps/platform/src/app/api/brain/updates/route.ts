/**
 * Brain update check endpoint.
 *
 * GET /api/brain/updates?workspace_id=<id>
 *
 * Compares a workspace's brain_manifest rows against the CORE registry
 * and returns pending updates, forked updates, and new files.
 * Designed to be called on every session start — must be fast.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { CORE_MANIFEST, computeContentHash } from '@repo/db/brain-manifest-registry';
import { getAuthUserId } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { safeErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

interface PendingUpdate {
  path: string;
  current_version: string;
  new_version: string;
  category: string;
  integration_group: string | null;
}

interface ForkedUpdate {
  path: string;
  new_version: string;
  update_summary: string | null;
  integration_group: string | null;
}

interface NewFile {
  path: string;
  version: string;
  tier: string;
  category: string;
  integration_group: string | null;
}

interface GroupedCounts {
  core: number;
  github: number;
  slack: number;
  voice: number;
  byok: number;
}

export async function GET(request: NextRequest) {
  const rl = await applyRateLimit(request, 'brain.updates', RATE_READ);
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

    // Service client: reads workspace brain_manifest rows. Accesses: brain_manifest.
    const supabase = createServiceClient();

    const { data: manifestRows, error } = await supabase
      .from('brain_manifest')
      .select('path, content_hash, version, is_forked, update_summary')
      .eq('workspace_id', workspaceId)
      .eq('is_core', true);

    if (error) {
      return NextResponse.json({ error: 'Failed to load manifest' }, { status: 500 });
    }

    // Index workspace manifest by path for O(1) lookups
    const workspaceManifest = new Map((manifestRows ?? []).map((row) => [row.path, row]));

    // Build a map of registry content hashes (keyed by path)
    // Since we don't have actual file content to hash at runtime,
    // we use the version as a proxy for change detection.
    // The real content_hash comparison happens against what was stored
    // when the workspace was bootstrapped/last synced.
    const registryByPath = new Map(CORE_MANIFEST.map((entry) => [entry.path, entry]));

    const pending: PendingUpdate[] = [];
    const forkedUpdates: ForkedUpdate[] = [];
    const newFiles: NewFile[] = [];

    // Check each registry entry against the workspace manifest
    for (const entry of CORE_MANIFEST) {
      const wsRow = workspaceManifest.get(entry.path);

      const group = entry.integrationGroup ?? null;

      if (!wsRow) {
        // Entry exists in registry but not in workspace = new file
        newFiles.push({
          path: entry.path,
          version: entry.version,
          tier: entry.tier,
          category: entry.category,
          integration_group: group,
        });
        continue;
      }

      // Compare versions — if registry version is newer, there's an update
      if (wsRow.version !== entry.version) {
        if (wsRow.is_forked) {
          // Forked: update available but not auto-applied
          forkedUpdates.push({
            path: entry.path,
            new_version: entry.version,
            update_summary: wsRow.update_summary,
            integration_group: group,
          });
        } else {
          // Not forked: pending auto-apply
          pending.push({
            path: entry.path,
            current_version: wsRow.version,
            new_version: entry.version,
            category: entry.category,
            integration_group: group,
          });
        }
      }
    }

    const upToDate = pending.length === 0 && forkedUpdates.length === 0 && newFiles.length === 0;

    // Build grouped counts for the banner
    const allUpdates = [...pending, ...forkedUpdates, ...newFiles];
    const grouped: GroupedCounts = { core: 0, github: 0, slack: 0, voice: 0, byok: 0 };
    for (const item of allUpdates) {
      const key = item.integration_group ?? 'core';
      if (key in grouped) grouped[key as keyof GroupedCounts]++;
    }

    return NextResponse.json({
      pending,
      forked_updates: forkedUpdates,
      new_files: newFiles,
      up_to_date: upToDate,
      grouped_counts: grouped,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
