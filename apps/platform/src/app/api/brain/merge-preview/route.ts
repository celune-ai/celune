/**
 * POST /api/brain/merge-preview
 *
 * Previews what a brain update would do at section level for a single file.
 * Compares the workspace's local version against the latest CORE version,
 * identifying unchanged sections, conflicts, additions, and local-only sections.
 *
 * Two-way diff (V1): local sections vs new CORE sections.
 * - Same hash = unchanged
 * - Different hash = conflict
 * - Only in CORE = added
 * - Only in local = local-only (user addition)
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { CORE_MANIFEST, computeContentHash } from '@repo/db/brain-manifest-registry';
import { parseSections, type BrainSection } from '@repo/db/brain-section-parser';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { brainMergePreviewSchema } from '@/lib/schemas/brain.schema';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

/** Max characters for section content previews. */
const PREVIEW_TRUNCATE = 200;

/** Resolve a brain file path and verify it doesn't escape the base directory. */
function safeBrainPath(baseDir: string, filePath: string): string | null {
  const resolved = resolve(baseDir, filePath);
  const resolvedBase = resolve(baseDir);
  if (!resolved.startsWith(resolvedBase + '/') && resolved !== resolvedBase) return null;
  return resolved;
}

/** Truncate content to PREVIEW_TRUNCATE chars, appending ellipsis if needed. */
function truncatePreview(content: string): string {
  if (content.length <= PREVIEW_TRUNCATE) return content;
  return content.slice(0, PREVIEW_TRUNCATE) + '...';
}

type BrainMergePreviewBody = z.infer<typeof brainMergePreviewSchema>;

interface UnchangedSection {
  key: string;
  heading: string;
}

interface ConflictSection {
  key: string;
  heading: string;
  local_preview: string;
  new_preview: string;
}

interface AddedSection {
  key: string;
  heading: string;
  preview: string;
}

interface LocalOnlySection {
  key: string;
  heading: string;
}

export const POST = withApiSecurity<BrainMergePreviewBody>(
  async (_request: NextRequest, { userId, body }: SecurityContext<BrainMergePreviewBody>) => {
    const { workspace_id, path } = body;

    // Service client: reads brain_manifest and workspace_memberships. Accesses: workspace_memberships, brain_manifest.
    const supabase = createServiceClient();

    // Verify workspace membership
    const { data: membership } = await supabase
      .from('workspace_memberships')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('workspace_id', workspace_id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 });
    }

    // Validate path exists in registry (prevents arbitrary path probing)
    const registryEntry = CORE_MANIFEST.find((e) => e.path === path);
    if (!registryEntry) {
      return NextResponse.json(
        { error: 'Path is not a valid CORE manifest entry' },
        { status: 400 },
      );
    }

    // Fetch brain_manifest row for this workspace + path
    const { data: manifestRow, error: fetchError } = await supabase
      .from('brain_manifest')
      .select('path, content_hash, version, is_forked, update_available')
      .eq('workspace_id', workspace_id)
      .eq('path', path)
      .maybeSingle();

    if (fetchError) {
      console.error('[brain-merge-preview] Fetch error:', fetchError);
      return NextResponse.json({ error: 'Failed to read brain manifest' }, { status: 500 });
    }

    // If not forked or no update available, no merge needed
    if (!manifestRow) {
      return NextResponse.json({ status: 'no_merge_needed', reason: 'path_not_in_workspace' });
    }

    if (!manifestRow.is_forked || manifestRow.version === registryEntry.version) {
      return NextResponse.json({ status: 'no_merge_needed', reason: 'up_to_date_or_not_forked' });
    }

    // Read the CORE (new) version from packages/brain/core/
    const coreBrainDir = join(process.cwd(), '..', '..', 'packages', 'brain', 'core');
    const coreFilePath = safeBrainPath(coreBrainDir, path);

    if (!coreFilePath || !existsSync(coreFilePath)) {
      return NextResponse.json(
        { error: 'Core brain file not found for this path' },
        { status: 404 },
      );
    }

    let newContent: string;
    try {
      newContent = readFileSync(coreFilePath, 'utf8');
    } catch {
      return NextResponse.json({ error: 'Failed to read core brain file' }, { status: 500 });
    }

    // For the local version, we need the workspace's actual file content.
    // The brain_manifest stores content_hash but not the content itself.
    // Attempt to read from brain_content table if it exists.
    let localContent: string | null = null;
    let baseContent: string | null = null;
    try {
      const { data: contentRow } = await supabase
        .from('brain_content')
        .select('content, base_content')
        .eq('workspace_id', workspace_id)
        .eq('path', path)
        .maybeSingle();
      localContent = contentRow?.content ?? null;
      baseContent = contentRow?.base_content ?? null;
    } catch {
      // brain_content table may not exist yet — fall through to file-level comparison
    }

    if (!localContent) {
      // No local content stored — can only do file-level comparison
      const newHash = computeContentHash(newContent);
      const hashesMatch = manifestRow.content_hash === newHash;

      return NextResponse.json({
        status: hashesMatch ? 'no_merge_needed' : 'merge_available',
        path,
        current_version: manifestRow.version,
        new_version: registryEntry.version,
        sections: hashesMatch ? { unchanged: [], conflicts: [], added: [], local_only: [] } : null,
        file_level_only: true,
        reason: 'local_content_not_stored',
      });
    }

    // Parse sections
    const localSections = parseSections(localContent);
    const newSections = parseSections(newContent);
    const baseSections = baseContent ? parseSections(baseContent) : null;

    // Index sections by key for comparison
    const localByKey = new Map<string, BrainSection>(localSections.map((s) => [s.key, s]));
    const newByKey = new Map<string, BrainSection>(newSections.map((s) => [s.key, s]));
    const baseByKey = baseSections
      ? new Map<string, BrainSection>(baseSections.map((s) => [s.key, s]))
      : null;

    // Collect all unique keys
    const allKeys = new Set<string>([...localByKey.keys(), ...newByKey.keys()]);

    const unchanged: UnchangedSection[] = [];
    const conflicts: ConflictSection[] = [];
    const added: AddedSection[] = [];
    const localOnly: LocalOnlySection[] = [];

    for (const key of allKeys) {
      const local = localByKey.get(key);
      const updated = newByKey.get(key);
      const base = baseByKey?.get(key);

      if (local && updated) {
        const heading = local.heading || updated.heading;
        if (local.hash === updated.hash) {
          // Both same → unchanged
          unchanged.push({ key, heading });
        } else if (baseByKey && base) {
          // Three-way: base available — check who changed
          if (base.hash === local.hash) {
            // Local unchanged, new has update → auto-merge (show as "added" update)
            added.push({
              key,
              heading,
              preview: truncatePreview(updated.content),
            });
          } else if (base.hash === updated.hash) {
            // New unchanged, local was customized → keep local (unchanged)
            unchanged.push({ key, heading });
          } else {
            // Both changed → true conflict
            conflicts.push({
              key,
              heading,
              local_preview: truncatePreview(local.content),
              new_preview: truncatePreview(updated.content),
            });
          }
        } else {
          // No base → two-way comparison, treat all diffs as conflicts
          conflicts.push({
            key,
            heading,
            local_preview: truncatePreview(local.content),
            new_preview: truncatePreview(updated.content),
          });
        }
      } else if (updated && !local) {
        added.push({
          key,
          heading: updated.heading,
          preview: truncatePreview(updated.content),
        });
      } else if (local && !updated) {
        localOnly.push({ key, heading: local.heading });
      }
    }

    return NextResponse.json({
      status: 'merge_available',
      path,
      current_version: manifestRow.version,
      new_version: registryEntry.version,
      sections: {
        unchanged,
        conflicts,
        added,
        local_only: localOnly,
      },
    });
  },
  {
    rateLimit: { tier: RATE_WRITE, routeKey: 'brain.merge-preview.post' },
    permission: 'settings:manage',
    parseBody: brainMergePreviewSchema,
  },
);
