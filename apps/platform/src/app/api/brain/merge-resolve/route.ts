/**
 * POST /api/brain/merge-resolve
 *
 * Accepts per-section merge resolutions and produces the final merged document.
 * Requires the file to be forked with an update available.
 *
 * For each section in the three-way diff:
 * - unchanged: kept as-is
 * - autoMerged: new content applied automatically
 * - conflicts: resolved by user choice (keep-local, accept-new, or custom)
 * - removed: omitted (user can provide custom content to restore)
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import {
  CORE_MANIFEST,
  computeContentHash,
  type ManifestEntry,
} from '@repo/db/brain-manifest-registry';
import { parseSections } from '@repo/db/brain-section-parser';
import { computeSectionMerge } from '@repo/db/brain-section-diff';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { brainMergeResolveSchema } from '@/lib/schemas/brain.schema';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

/** Resolve a brain file path and verify it doesn't escape the base directory. */
function safeBrainPath(baseDir: string, filePath: string): string | null {
  const resolved = resolve(baseDir, filePath);
  const resolvedBase = resolve(baseDir);
  if (!resolved.startsWith(resolvedBase + '/') && resolved !== resolvedBase) return null;
  return resolved;
}

type BrainMergeResolveBody = z.infer<typeof brainMergeResolveSchema>;

export const POST = withApiSecurity<BrainMergeResolveBody>(
  async (_request: NextRequest, { userId, body }: SecurityContext<BrainMergeResolveBody>) => {
    const { workspace_id, path, resolutions } = body;

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

    // Validate path exists in CORE manifest
    const registryEntry = CORE_MANIFEST.find((e) => e.path === path) as ManifestEntry | undefined;
    if (!registryEntry) {
      return NextResponse.json(
        { error: 'Path is not a valid CORE manifest entry' },
        { status: 400 },
      );
    }

    // Fetch brain_manifest row
    const { data: manifestRow, error: fetchError } = await supabase
      .from('brain_manifest')
      .select('id, path, content_hash, version, is_forked, update_available, updated_at')
      .eq('workspace_id', workspace_id)
      .eq('path', path)
      .maybeSingle();

    if (fetchError) {
      console.error('[brain-merge-resolve] Fetch error:', fetchError);
      return NextResponse.json({ error: 'Failed to read brain manifest' }, { status: 500 });
    }

    if (!manifestRow) {
      return NextResponse.json(
        { error: 'Path not found in workspace brain manifest' },
        { status: 404 },
      );
    }

    // Require the file is forked with an update available
    if (!manifestRow.is_forked) {
      return NextResponse.json(
        { error: 'File is not forked — use apply-updates for non-forked files' },
        { status: 400 },
      );
    }

    if (!manifestRow.update_available) {
      return NextResponse.json({ error: 'No update available for this file' }, { status: 400 });
    }

    // Read CORE (new) content from filesystem
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

    // Read local content from brain_content table
    let localContent: string | null = null;
    try {
      const { data: contentRow } = await supabase
        .from('brain_content')
        .select('content')
        .eq('workspace_id', workspace_id)
        .eq('path', path)
        .maybeSingle();
      localContent = contentRow?.content ?? null;
    } catch {
      // brain_content table may not exist yet
    }

    if (!localContent) {
      return NextResponse.json(
        {
          error:
            'Local content not available — section-level merge requires brain_content storage. Use apply-updates for file-level updates.',
        },
        { status: 400 },
      );
    }

    // Read the base version — the CORE content at the time the user forked.
    // Stored as base_content in brain_content table when fork is first detected.
    // Falls back to local content (two-way diff) if base not available.
    let baseContent = localContent;
    try {
      const { data: baseRow } = await supabase
        .from('brain_content')
        .select('base_content')
        .eq('workspace_id', workspace_id)
        .eq('path', path)
        .maybeSingle();
      if (baseRow?.base_content) {
        baseContent = baseRow.base_content;
      }
    } catch {
      // base_content column may not exist yet — fall back to two-way
    }
    const mergeResult = computeSectionMerge(baseContent, localContent, newContent);

    // Build a map of resolutions by section key for quick lookup
    const resolutionMap = new Map(resolutions.map((r) => [r.section_key, r]));

    // Validate that every conflict has a resolution
    const unresolvedConflicts = mergeResult.conflicts.filter((c) => !resolutionMap.has(c.key));
    if (unresolvedConflicts.length > 0) {
      return NextResponse.json(
        {
          error: 'Missing resolutions for conflicting sections',
          unresolved: unresolvedConflicts.map((c) => c.key),
        },
        { status: 400 },
      );
    }

    // Validate that removed sections with resolutions have valid choices
    const removedKeys = new Set(mergeResult.removed.map((r) => r.key));
    for (const [key, resolution] of resolutionMap) {
      if (removedKeys.has(key) && resolution.choice === 'accept-new') {
        // accept-new for a removed section means "accept removal" — that's fine, omit it
        continue;
      }
    }

    // Build the final merged document by preserving section ordering.
    // Order: all sections from local (in order), then any new sections added by CORE.
    const localSections = parseSections(localContent);
    const newSections = parseSections(newContent);

    // Track which keys we've already included
    const includedKeys = new Set<string>();
    const mergedSectionContents: string[] = [];

    // Index merge results by key for quick lookup
    const unchangedKeys = new Set(mergeResult.unchanged.map((s) => s.key));
    const autoMergedByKey = new Map(mergeResult.autoMerged.map((s) => [s.key, s]));
    const conflictByKey = new Map(mergeResult.conflicts.map((s) => [s.key, s]));
    const removedKeySet = new Set(mergeResult.removed.map((s) => s.key));

    // Process local sections first (preserves local ordering)
    for (const section of localSections) {
      const { key } = section;
      includedKeys.add(key);

      if (unchangedKeys.has(key)) {
        // Unchanged — keep as-is
        mergedSectionContents.push(section.content);
      } else if (autoMergedByKey.has(key)) {
        // Auto-merged — use new content
        mergedSectionContents.push(autoMergedByKey.get(key)!.content);
      } else if (conflictByKey.has(key)) {
        // Conflict — apply user resolution
        const resolution = resolutionMap.get(key)!;
        const conflict = conflictByKey.get(key)!;

        switch (resolution.choice) {
          case 'keep-local':
            mergedSectionContents.push(conflict.localContent);
            break;
          case 'accept-new':
            mergedSectionContents.push(conflict.newContent);
            break;
          case 'custom':
            mergedSectionContents.push(resolution.custom_content!);
            break;
        }
      } else if (removedKeySet.has(key)) {
        // Section removed in new version
        const resolution = resolutionMap.get(key);
        if (resolution) {
          switch (resolution.choice) {
            case 'keep-local':
              mergedSectionContents.push(section.content);
              break;
            case 'accept-new':
              // Accept removal — omit the section
              break;
            case 'custom':
              mergedSectionContents.push(resolution.custom_content!);
              break;
          }
        }
        // No resolution for removed section → omit it (default behavior)
      }
    }

    // Add any new sections from CORE that weren't in local (added sections)
    for (const section of newSections) {
      if (!includedKeys.has(section.key)) {
        const autoMerged = autoMergedByKey.get(section.key);
        if (autoMerged) {
          mergedSectionContents.push(autoMerged.content);
          includedKeys.add(section.key);
        }
      }
    }

    // Reassemble the final document
    const finalContent = mergedSectionContents.join('\n');
    const finalHash = computeContentHash(finalContent);

    // Update brain_content with the merged result.
    // Store the new CORE version as base_content for future three-way merges.
    const { error: contentUpdateError } = await supabase.from('brain_content').upsert(
      {
        workspace_id,
        path,
        content: finalContent,
        base_content: newContent,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,path' },
    );

    if (contentUpdateError) {
      console.error('[brain-merge-resolve] Content update error:', contentUpdateError);
      return NextResponse.json({ error: 'Failed to update brain content' }, { status: 500 });
    }

    // Update brain_manifest: new hash, new version, still forked (user customized), no update available
    const { error: manifestUpdateError } = await supabase
      .from('brain_manifest')
      .update({
        content_hash: finalHash,
        version: registryEntry.version,
        is_forked: true,
        update_available: false,
        update_summary: null,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspace_id)
      .eq('path', path)
      .eq('updated_at', manifestRow.updated_at); // Optimistic locking

    if (manifestUpdateError) {
      console.error('[brain-merge-resolve] Manifest update error:', manifestUpdateError);
      return NextResponse.json({ error: 'Failed to update brain manifest' }, { status: 500 });
    }

    // Update brain_section_hashes for each section in the merged result
    // Table uses manifest_id (FK to brain_manifest.id), not workspace_id/path
    const manifestId = manifestRow.id;
    const mergedSections = parseSections(finalContent);

    if (mergedSections.length > 0 && manifestId) {
      try {
        // Delete existing section hashes for this manifest entry
        await supabase.from('brain_section_hashes').delete().eq('manifest_id', manifestId);

        // Insert new section hashes
        const sectionHashRows = mergedSections.map((s) => ({
          manifest_id: manifestId,
          section_key: s.key,
          content_hash: s.hash,
          is_forked: false,
          update_available: false,
        }));

        await supabase.from('brain_section_hashes').insert(sectionHashRows);
      } catch (err) {
        console.error('[brain-merge-resolve] Section hash sync error:', err);
        // Non-fatal: the merge itself succeeded
      }
    }

    const sectionsResolved =
      mergeResult.conflicts.length +
      mergeResult.removed.filter((r) => resolutionMap.has(r.key)).length;

    return NextResponse.json({
      status: 'merged',
      path,
      sections_resolved: sectionsResolved,
      final_version: registryEntry.version,
    });
  },
  {
    rateLimit: { tier: RATE_WRITE, routeKey: 'brain.merge-resolve.post' },
    permission: 'settings:manage',
    parseBody: brainMergeResolveSchema,
  },
);
