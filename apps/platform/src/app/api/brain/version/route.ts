import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { CORE_MANIFEST, computeContentHash } from '@repo/db/brain-manifest-registry';
import { parseSections } from '@repo/db/brain-section-parser';
import { getAuthUserId } from '@/lib/auth';
import { validateOrigin } from '@/lib/csrf';
import { brainVersionPostSchema } from '@/lib/schemas/brain.schema';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

/**
 * Current brain package version.
 * Increment when new skills, hooks, or agents are added/updated.
 */
const CURRENT_BRAIN_VERSION = '1.0.0';

/**
 * Changelog of brain package updates.
 * Each entry describes what changed in that version.
 */
const BRAIN_CHANGELOG: {
  version: string;
  date: string;
  changes: string[];
}[] = [
  {
    version: '1.0.0',
    date: '2026-03-09',
    changes: [
      'Initial brain package release',
      '2 essential skills: debugging, context-management',
      '3 standard skills: code-review, tdd, worktree-workflow',
      '3 hooks: session-start, auto-format, tdd-enforcement',
      '5 agent archetypes per use case',
      '4 agent docs: task-management, prompt-template, skill-workflow, research-tool-stack',
    ],
  },
];

/** Resolve a brain file path and verify it doesn't escape the base directory. */
function safeBrainPath(baseDir: string, filePath: string): string | null {
  const resolved = resolve(baseDir, filePath);
  const resolvedBase = resolve(baseDir);
  if (!resolved.startsWith(resolvedBase + '/') && resolved !== resolvedBase) return null;
  return resolved;
}

/**
 * Sync section-level hashes for a manifest entry.
 * Compares CORE sections against local sections and upserts brain_section_hashes rows.
 * Wrapped in try/catch so it degrades gracefully if the table doesn't exist.
 */
async function syncSectionHashes(
  supabase: ReturnType<typeof createServiceClient>,
  manifestId: string,
  coreSections: ReturnType<typeof parseSections>,
  localSections?: ReturnType<typeof parseSections>,
): Promise<{ sections_with_updates: number }> {
  let sectionsWithUpdates = 0;

  try {
    // Build a map of local section hashes for comparison
    const localHashByKey = new Map<string, string>();
    if (localSections) {
      for (const section of localSections) {
        localHashByKey.set(section.key, section.hash);
      }
    }

    // Upsert section hashes for each CORE section
    for (const section of coreSections) {
      const localHash = localHashByKey.get(section.key);
      const isForked = localHash !== undefined && localHash !== section.hash;
      const updateAvailable = isForked;

      if (updateAvailable) {
        sectionsWithUpdates++;
      }

      await supabase.from('brain_section_hashes').upsert(
        {
          manifest_id: manifestId,
          section_key: section.key,
          content_hash: section.hash,
          is_forked: isForked,
          update_available: updateAvailable,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'manifest_id,section_key' },
      );
    }

    // Remove stale section hashes (sections that no longer exist in CORE)
    const coreKeys = new Set(coreSections.map((s) => s.key));
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
    console.warn('[brain-version] Section hash sync failed (table may not exist):', error);
  }

  return { sections_with_updates: sectionsWithUpdates };
}

/**
 * GET /api/brain/version?workspace_id=<uuid>
 *
 * Returns the current brain version and whether the workspace is up to date.
 * Compares workspace's brain_config.bootstrap_version against CURRENT_BRAIN_VERSION.
 * Also computes section-level update counts for manifest entries with updates.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }
    if (!isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 });
    }

    // Service client: reads workspace metadata.
    const supabase = createServiceClient();

    // Verify membership
    const { data: membership } = await supabase
      .from('workspace_memberships')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 });
    }

    // Get workspace brain version
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('metadata')
      .eq('id', workspaceId)
      .single();

    const metadata = workspace?.metadata as Record<string, unknown> | null;
    const brainConfig = metadata?.brain_config as Record<string, unknown> | null;
    const workspaceVersion = (brainConfig?.bootstrap_version as string) ?? null;

    const isUpToDate = workspaceVersion === CURRENT_BRAIN_VERSION;

    // Find updates since workspace version (semver-safe comparison)
    const compareSemver = (a: string, b: string): number => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
      }
      return 0;
    };

    const pendingUpdates = workspaceVersion
      ? BRAIN_CHANGELOG.filter((entry) => compareSemver(entry.version, workspaceVersion) > 0)
      : BRAIN_CHANGELOG;

    // Compute section-level update stats for files with updates
    let totalSectionsWithUpdates = 0;
    try {
      const { data: manifestRows } = await supabase
        .from('brain_manifest')
        .select('id, path, content_hash, is_forked, update_available')
        .eq('workspace_id', workspaceId)
        .eq('update_available', true);

      if (manifestRows && manifestRows.length > 0) {
        const coreBrainDir = join(process.cwd(), '..', '..', 'packages', 'brain', 'core');
        const registryByPath = new Map(CORE_MANIFEST.map((e) => [e.path, e]));

        for (const row of manifestRows) {
          const registryEntry = registryByPath.get(row.path);
          if (!registryEntry) continue;

          // Read the CORE file content and parse sections
          const coreFilePath = safeBrainPath(coreBrainDir, row.path);
          if (!coreFilePath || !existsSync(coreFilePath)) continue;

          try {
            const coreContent = readFileSync(coreFilePath, 'utf8');
            const coreSections = parseSections(coreContent);

            // If the file has a different local hash, try to parse local content too
            // For now, sync CORE sections and count updates
            const result = await syncSectionHashes(supabase, row.id, coreSections);
            totalSectionsWithUpdates += result.sections_with_updates;
          } catch {
            // Skip files that can't be read
          }
        }
      }
    } catch {
      // Section-level stats are supplementary — don't fail the endpoint
    }

    return NextResponse.json({
      current_version: CURRENT_BRAIN_VERSION,
      workspace_version: workspaceVersion,
      is_up_to_date: isUpToDate,
      pending_updates: pendingUpdates,
      total_versions: BRAIN_CHANGELOG.length,
      sections_with_updates: totalSectionsWithUpdates,
    });
  } catch (error) {
    console.error('[brain-version] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/brain/version?workspace_id=<uuid>
 *
 * Marks the workspace as updated to the current brain version.
 * Called after the user applies updates via the CLI or admin UI.
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'brain.version.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = brainVersionPostSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const workspaceId = parsed.data.workspace_id;

    const supabase = createServiceClient();

    // Verify membership
    const { data: membership } = await supabase
      .from('workspace_memberships')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 });
    }

    // Get current metadata
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('metadata')
      .eq('id', workspaceId)
      .single();

    const metadata = (workspace?.metadata as Record<string, unknown>) ?? {};
    const brainConfig = (metadata.brain_config as Record<string, unknown>) ?? {};

    // Update version
    brainConfig.bootstrap_version = CURRENT_BRAIN_VERSION;
    brainConfig.last_updated_at = new Date().toISOString();
    metadata.brain_config = brainConfig;

    const { error } = await supabase
      .from('workspaces')
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq('id', workspaceId);

    if (error) {
      return NextResponse.json({ error: 'Failed to update version' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      version: CURRENT_BRAIN_VERSION,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[brain-version] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
