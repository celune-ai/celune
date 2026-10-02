import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import {
  CORE_MANIFEST,
  type ManifestEntry,
  computeContentHash,
} from '@repo/db/brain-manifest-registry';
import { parseSections } from '@repo/db/brain-section-parser';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { brainApplyUpdatesSchema } from '@/lib/schemas/brain.schema';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve a brain file path and verify it doesn't escape the base directory. */
function safeBrainPath(baseDir: string, filePath: string): string | null {
  const resolved = resolve(baseDir, filePath);
  const resolvedBase = resolve(baseDir);
  if (!resolved.startsWith(resolvedBase + '/') && resolved !== resolvedBase) return null;
  return resolved;
}

interface AppliedEntry {
  path: string;
  new_version: string;
}

interface SkippedEntry {
  path: string;
}

interface ErrorEntry {
  path: string;
  error: string;
}

/**
 * Sync section-level hashes for a manifest entry after applying an update.
 * Parses CORE content into sections and upserts brain_section_hashes rows.
 * Clears update_available on all section hashes since the file was just updated.
 * Wrapped in try/catch so it degrades gracefully if the table doesn't exist.
 */
async function syncSectionHashesAfterUpdate(
  supabase: ReturnType<typeof createServiceClient>,
  manifestId: string,
  coreContent: string,
): Promise<void> {
  try {
    const sections = parseSections(coreContent);

    // Upsert section hashes — all sections are now up to date
    for (const section of sections) {
      await supabase.from('brain_section_hashes').upsert(
        {
          manifest_id: manifestId,
          section_key: section.key,
          content_hash: section.hash,
          is_forked: false,
          update_available: false,
          update_summary: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'manifest_id,section_key' },
      );
    }

    // Remove stale section hashes (sections removed from CORE)
    const coreKeys = new Set(sections.map((s) => s.key));
    const { data: existingRows } = await supabase
      .from('brain_section_hashes')
      .select('id, section_key')
      .eq('manifest_id', manifestId);

    if (existingRows) {
      const staleIds = existingRows
        .filter((row) => !coreKeys.has(row.section_key))
        .map((row) => row.id);
      if (staleIds.length > 0) {
        await supabase.from('brain_section_hashes').delete().in('id', staleIds);
      }
    }
  } catch (error) {
    // Table may not exist yet — degrade gracefully
    console.warn('[brain-apply-updates] Section hash sync failed (table may not exist):', error);
  }
}

/**
 * POST /api/brain/apply-updates
 *
 * Applies pending CORE brain manifest updates to a workspace.
 * - If `paths` provided: apply only those specific paths
 * - Otherwise: apply ALL pending non-forked updates
 * - `force=true`: reset forked files to CORE version
 */
type BrainApplyUpdatesBody = z.infer<typeof brainApplyUpdatesSchema>;

export const POST = withApiSecurity<BrainApplyUpdatesBody>(
  async (_request: NextRequest, { userId, body }: SecurityContext<BrainApplyUpdatesBody>) => {
    const { workspace_id, paths, force } = body;

    // Service client: applies brain manifest updates. Accesses: workspace_memberships, brain_manifest.
    const supabase = createServiceClient();

    // Verify membership
    const { data: membership } = await supabase
      .from('workspace_memberships')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('workspace_id', workspace_id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 });
    }

    // Fetch current brain_manifest rows for this workspace (include updated_at for optimistic locking)
    const { data: manifestRows, error: fetchError } = await supabase
      .from('brain_manifest')
      .select('id, path, content_hash, version, is_forked, updated_at')
      .eq('workspace_id', workspace_id);

    if (fetchError) {
      console.error('[brain-apply-updates] Fetch error:', fetchError);
      return NextResponse.json({ error: 'Failed to read brain manifest' }, { status: 500 });
    }

    // Index existing rows by path for fast lookup
    const existingByPath = new Map((manifestRows ?? []).map((row) => [row.path, row]));

    // Build the lookup for registry entries
    const registryByPath = new Map(CORE_MANIFEST.map((entry) => [entry.path, entry]));

    // Determine which paths to process
    let targetPaths: string[];

    if (paths && paths.length > 0) {
      // Validate paths array bounds
      if (!Array.isArray(paths) || paths.length > 100 || paths.some((p) => typeof p !== 'string')) {
        return NextResponse.json({ error: 'Invalid paths array' }, { status: 400 });
      }
      // Validate all requested paths exist in the registry
      const invalid = paths.filter((p) => !registryByPath.has(p));
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: 'One or more paths are not valid CORE manifest entries' },
          { status: 400 },
        );
      }
      targetPaths = paths;
    } else {
      // All paths with pending updates (update_available=true), excluding forked unless force
      targetPaths = (manifestRows ?? [])
        .filter((row) => {
          // Must have a pending update
          const registryEntry = registryByPath.get(row.path);
          if (!registryEntry) return false;

          // Check if there is actually an update available
          if (row.version === registryEntry.version) return false;

          // Skip forked files unless force
          if (row.is_forked && !force) return false;

          return true;
        })
        .map((row) => row.path);
    }

    const applied: AppliedEntry[] = [];
    const skippedForked: SkippedEntry[] = [];
    const errors: ErrorEntry[] = [];

    const coreBrainDir = join(process.cwd(), '..', '..', 'packages', 'brain', 'core');

    for (const path of targetPaths) {
      const registryEntry = registryByPath.get(path) as ManifestEntry;
      const existing = existingByPath.get(path);

      // Skip forked files unless force=true or explicitly requested in paths list
      if (existing?.is_forked && !force && !(paths && paths.includes(path))) {
        skippedForked.push({ path });
        continue;
      }

      // Idempotency: skip if already at registry version
      if (existing && existing.version === registryEntry.version) {
        continue;
      }

      // Compute real SHA-256 hash from core brain files
      let contentHash = 'pending';
      let coreContent: string | null = null;
      try {
        const coreFilePath = safeBrainPath(coreBrainDir, path);
        if (coreFilePath && existsSync(coreFilePath)) {
          coreContent = readFileSync(coreFilePath, 'utf8');
          contentHash = computeContentHash(coreContent);
        }
      } catch {
        // Fall back to 'pending' if core file not readable
      }

      // Build the update payload
      const updatePayload: Record<string, unknown> = {
        content_hash: contentHash,
        version: registryEntry.version,
        update_available: false,
        update_summary: null,
        updated_at: new Date().toISOString(),
      };

      // If force and file was forked, reset fork state
      if (force && existing?.is_forked) {
        updatePayload.is_forked = false;
        updatePayload.forked_at = null;
      }

      let manifestId: string | null = null;

      if (existing) {
        // Optimistic locking: only update if the row hasn't been modified since we read it.
        // This prevents race conditions between concurrent fork-check and apply-updates.
        let query = supabase
          .from('brain_manifest')
          .update(updatePayload)
          .eq('workspace_id', workspace_id)
          .eq('path', path);

        // Add optimistic lock check if we have updated_at
        if (existing.updated_at) {
          query = query.eq('updated_at', existing.updated_at);
        }

        const { data: updatedRow, error: updateError } = await query
          .select('id, path')
          .maybeSingle();

        if (updateError) {
          console.error(`[brain-apply-updates] Update error for ${path}:`, updateError);
          errors.push({ path, error: 'Failed to update manifest entry' });
          continue;
        }

        // If no row returned and we used optimistic locking, the row was modified concurrently
        if (!updatedRow && existing.updated_at) {
          errors.push({ path, error: 'Concurrent modification detected — retry' });
          continue;
        }

        manifestId = updatedRow?.id ?? existing.id;
      } else {
        // Insert new row for paths that don't exist yet in the workspace
        const { data: insertedRow, error: insertError } = await supabase
          .from('brain_manifest')
          .insert({
            workspace_id,
            path: registryEntry.path,
            content_hash: contentHash,
            version: registryEntry.version,
            tier: registryEntry.tier,
            category: registryEntry.category,
            is_core: registryEntry.isCore,
            ownership_scope: registryEntry.ownershipScope ?? 'core',
            integration_group: registryEntry.integrationGroup ?? null,
            is_forked: false,
            update_available: false,
          })
          .select('id')
          .single();

        if (insertError) {
          console.error(`[brain-apply-updates] Insert error for ${path}:`, insertError);
          errors.push({ path, error: 'Failed to insert manifest entry' });
          continue;
        }

        manifestId = insertedRow?.id ?? null;
      }

      // Sync section-level hashes if we have manifest ID and core content
      if (manifestId && coreContent) {
        await syncSectionHashesAfterUpdate(supabase, manifestId, coreContent);
      }

      applied.push({ path, new_version: registryEntry.version });
    }

    return NextResponse.json({
      applied,
      skipped_forked: skippedForked,
      errors,
    });
  },
  {
    rateLimit: { tier: RATE_WRITE, routeKey: 'brain.apply-updates.post' },
    permission: 'settings:manage',
    parseBody: brainApplyUpdatesSchema,
  },
);
