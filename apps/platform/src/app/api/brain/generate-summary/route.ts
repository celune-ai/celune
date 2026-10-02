/**
 * POST /api/brain/generate-summary
 *
 * Generates AI summaries for forked brain files that have pending updates.
 * Called on-demand (not on every session start) to avoid latency.
 *
 * Reads the core brain file content and the workspace's current version,
 * then uses a simple diff description (not actual code diffs) to produce
 * a human-readable summary of what changed.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { CORE_MANIFEST } from '@repo/db/brain-manifest-registry';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { brainGenerateSummarySchema } from '@/lib/schemas/brain.schema';
import { RATE_AI } from '@/lib/rate-limiter';
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

type BrainGenerateSummaryBody = z.infer<typeof brainGenerateSummarySchema>;

export const POST = withApiSecurity<BrainGenerateSummaryBody>(
  async (_request: NextRequest, { userId, body }: SecurityContext<BrainGenerateSummaryBody>) => {
    const { workspace_id, paths } = body;

    // Service client: reads and updates brain_manifest. Accesses: workspace_memberships, brain_manifest.
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

    // Fetch forked manifest rows that need summaries
    let query = supabase
      .from('brain_manifest')
      .select('path, version, update_summary')
      .eq('workspace_id', workspace_id)
      .eq('is_core', true)
      .eq('is_forked', true);

    if (paths && paths.length > 0) {
      if (!Array.isArray(paths) || paths.length > 100 || paths.some((p) => typeof p !== 'string')) {
        return NextResponse.json({ error: 'Invalid paths array' }, { status: 400 });
      }
      query = query.in('path', paths);
    }

    const { data: forkedRows, error: fetchError } = await query;

    if (fetchError) {
      return NextResponse.json({ error: 'Failed to fetch manifest' }, { status: 500 });
    }

    const registryByPath = new Map(CORE_MANIFEST.map((e) => [e.path, e]));
    const coreBrainDir = join(process.cwd(), '..', '..', 'packages', 'brain', 'core');

    const generated: { path: string; summary: string }[] = [];
    const skipped: string[] = [];

    for (const row of forkedRows ?? []) {
      // Skip if summary already exists
      if (row.update_summary) {
        skipped.push(row.path);
        continue;
      }

      const registryEntry = registryByPath.get(row.path);
      if (!registryEntry || registryEntry.version === row.version) {
        skipped.push(row.path);
        continue;
      }

      // Read core brain file content for the new version
      const coreFilePath = safeBrainPath(coreBrainDir, row.path);
      let newContent = '';
      try {
        if (coreFilePath && existsSync(coreFilePath)) {
          newContent = readFileSync(coreFilePath, 'utf8');
        }
      } catch {
        skipped.push(row.path);
        continue;
      }

      if (!newContent) {
        skipped.push(row.path);
        continue;
      }

      // Generate a summary based on the file description and content structure
      // Use a lightweight heuristic rather than calling an LLM (keeps it fast + free)
      const summary = generateDiffSummary(row.path, registryEntry, newContent);

      // Store the summary
      const { error: updateError } = await supabase
        .from('brain_manifest')
        .update({
          update_summary: summary,
          update_available: true,
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspace_id)
        .eq('path', row.path);

      if (!updateError) {
        generated.push({ path: row.path, summary });
      }
    }

    return NextResponse.json({
      generated: generated.length,
      skipped: skipped.length,
      summaries: generated,
    });
  },
  {
    rateLimit: { tier: RATE_AI, routeKey: 'brain.generate-summary.post' },
    permission: 'settings:manage',
    parseBody: brainGenerateSummarySchema,
  },
);

/**
 * Generate a human-readable diff summary from file content.
 * Uses heuristic analysis (section headers, line counts) rather than LLM calls.
 */
function generateDiffSummary(
  path: string,
  registryEntry: { description: string; version: string; category: string },
  newContent: string,
): string {
  const fileName = path.split('/').pop() ?? path;
  const sections = newContent.match(/^##\s+.+$/gm) ?? [];
  const lineCount = newContent.split('\n').length;

  const parts: string[] = [
    `Updated to v${registryEntry.version}.`,
    `${registryEntry.description}.`,
  ];

  if (sections.length > 0) {
    parts.push(
      `Contains ${sections.length} section${sections.length === 1 ? '' : 's'}: ${sections
        .slice(0, 3)
        .map((s) => s.replace(/^##\s+/, ''))
        .join(', ')}${sections.length > 3 ? ` (+${sections.length - 3} more)` : ''}.`,
    );
  }

  parts.push(`${lineCount} lines total.`);
  parts.push('Review the diff before accepting to preserve your customizations.');

  return parts.join(' ');
}
