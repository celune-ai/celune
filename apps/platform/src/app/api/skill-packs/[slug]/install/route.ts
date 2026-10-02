/**
 * Skill Pack install/uninstall endpoint.
 *
 * POST   /api/skill-packs/:slug/install  { workspace_id }  — Install a pack
 * DELETE /api/skill-packs/:slug/install  { workspace_id }  — Uninstall a pack
 *
 * Installing a pack creates brain_manifest entries for each skill in the pack
 * and records the installation in skill_pack_installs.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { computeContentHash } from '@repo/db/brain-manifest-registry';
import { z } from 'zod';
import type { SkillPackEntry } from '@repo/types';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ slug: string }> };

const installSchema = z
  .object({
    workspace_id: z.string().uuid(),
  })
  .strip();

export async function POST(request: NextRequest, context: RouteContext) {
  const originError = await validateOrigin(request);
  if (originError) return originError;
  const rateLimitResult = await applyRateLimit(request, 'skill-packs.install', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { slug } = await context.params;

    const parsed = await parseBody(request, installSchema);
    if (isErrorResponse(parsed)) return parsed;

    const { workspace_id } = parsed;

    const forbidden = await requireWorkspaceMembership(userId, workspace_id);
    if (forbidden) return forbidden;

    // Service client: reads skill pack, inserts manifest entries and install record.
    // Accesses: skill_packs, brain_manifest, skill_pack_installs.
    const supabase = createServiceClient();

    // Fetch the skill pack
    const { data: pack, error: packError } = await supabase
      .from('skill_packs')
      .select('id, slug, name, version, skill_entries')
      .eq('slug', slug)
      .eq('is_published', true)
      .single();

    if (packError || !pack) {
      return NextResponse.json({ error: 'Skill pack not found' }, { status: 404 });
    }

    // Check if already installed
    const { data: existingInstall } = await supabase
      .from('skill_pack_installs')
      .select('id')
      .eq('workspace_id', workspace_id)
      .eq('skill_pack_id', pack.id)
      .maybeSingle();

    if (existingInstall) {
      return NextResponse.json({ error: 'Pack already installed' }, { status: 409 });
    }

    const skillEntries = (pack.skill_entries as SkillPackEntry[]) ?? [];
    const now = new Date().toISOString();

    // Create brain_manifest entries for each skill in the pack
    const manifestRows = skillEntries.map((entry) => ({
      workspace_id,
      path: entry.path,
      content_hash: computeContentHash(''),
      version: entry.version ?? pack.version,
      tier: entry.tier,
      category: entry.category,
      description: entry.description,
      tags: [],
      skill_pack_id: pack.id,
      install_source: 'pack' as const,
      is_core: true,
      is_forked: false,
      is_enabled: true,
      ownership_scope: 'core' as const,
      update_available: false,
      update_summary: null,
      created_at: now,
      updated_at: now,
    }));

    if (manifestRows.length > 0) {
      const { error: manifestError } = await supabase
        .from('brain_manifest')
        .upsert(manifestRows, { onConflict: 'workspace_id,path' });

      if (manifestError) {
        console.error('[skill-packs] Manifest insert error:', manifestError);
        return NextResponse.json({ error: 'Failed to install skill pack' }, { status: 500 });
      }
    }

    // Record the installation
    const { error: installError } = await supabase.from('skill_pack_installs').insert({
      workspace_id,
      skill_pack_id: pack.id,
      installed_by: userId,
      version_installed: pack.version,
    });

    if (installError) {
      console.error('[skill-packs] Install record error:', installError);
      // Non-fatal — skills are already installed
    }

    // Increment install count (non-fatal if RPC doesn't exist yet)
    try {
      await supabase.rpc('increment_counter', {
        table_name: 'skill_packs',
        column_name: 'install_count',
        row_id: pack.id,
      });
    } catch {
      // Non-fatal — counter is denormalized
    }

    return NextResponse.json({
      ok: true,
      pack: { slug: pack.slug, name: pack.name },
      skills_installed: manifestRows.length,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const originError = await validateOrigin(request);
  if (originError) return originError;
  const rateLimitResult = await applyRateLimit(request, 'skill-packs.uninstall', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { slug } = await context.params;

    const parsed = await parseBody(request, installSchema);
    if (isErrorResponse(parsed)) return parsed;

    const { workspace_id } = parsed;

    const forbidden = await requireWorkspaceMembership(userId, workspace_id);
    if (forbidden) return forbidden;

    // Service client: removes skill pack install and associated manifest entries.
    // Accesses: skill_packs, brain_manifest, skill_pack_installs.
    const supabase = createServiceClient();

    // Fetch the skill pack
    const { data: pack } = await supabase
      .from('skill_packs')
      .select('id')
      .eq('slug', slug)
      .single();

    if (!pack) {
      return NextResponse.json({ error: 'Skill pack not found' }, { status: 404 });
    }

    // Remove manifest entries that came from this pack
    const { error: deleteManifestError } = await supabase
      .from('brain_manifest')
      .delete()
      .eq('workspace_id', workspace_id)
      .eq('skill_pack_id', pack.id)
      .eq('install_source', 'pack');

    if (deleteManifestError) {
      console.error('[skill-packs] Manifest delete error:', deleteManifestError);
    }

    // Remove the install record
    const { error: deleteInstallError } = await supabase
      .from('skill_pack_installs')
      .delete()
      .eq('workspace_id', workspace_id)
      .eq('skill_pack_id', pack.id);

    if (deleteInstallError) {
      console.error('[skill-packs] Install record delete error:', deleteInstallError);
    }

    return NextResponse.json({ ok: true, pack: { slug } });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
