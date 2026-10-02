/**
 * Skills CRUD endpoint.
 *
 * GET  /api/skills?workspace_id=<id>&category=<cat>&enabled_only=true
 * POST /api/skills  { workspace_id, path, category, tier, description, tags, install_source }
 *
 * Returns brain_manifest entries filtered to skills for a workspace.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { z } from 'zod';
import { computeContentHash } from '@repo/db/brain-manifest-registry';
import {
  validateBYOSkill,
  meetsQualityGate,
  MIN_QUALITY_SCORE,
} from '@repo/db/byo-skill-validator';
import type { BrainCategory, BrainTier, SkillInstallSource } from '@repo/types';

export const dynamic = 'force-dynamic';

const createSkillSchema = z.object({
  workspace_id: z.string().uuid(),
  path: z.string().min(1).max(500),
  category: z.enum(['skill', 'hook', 'agent', 'agent_doc', 'memory', 'settings', 'delegation']),
  tier: z.enum(['essential', 'standard', 'premium']).default('essential'),
  description: z.string().max(500).optional(),
  tags: z.array(z.string().max(50)).max(10).default([]),
  install_source: z.enum(['bootstrap', 'pack', 'byo', 'manual']).default('manual'),
  content: z.string().max(100_000).optional(),
  version: z.string().max(20).default('1.0.0'),
});

export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId || !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Valid workspace_id is required' }, { status: 400 });
    }

    const forbidden = await requireWorkspaceMembership(userId, workspaceId);
    if (forbidden) return forbidden;

    const category = request.nextUrl.searchParams.get('category') as BrainCategory | null;
    const enabledOnly = request.nextUrl.searchParams.get('enabled_only') === 'true';
    const installSource = request.nextUrl.searchParams.get(
      'install_source',
    ) as SkillInstallSource | null;

    // Service client: reads brain_manifest for a workspace. Accesses: brain_manifest.
    const supabase = createServiceClient();

    let query = supabase
      .from('brain_manifest')
      .select(
        'id, path, version, tier, category, description, tags, is_core, is_forked, is_enabled, install_source, skill_pack_id, quality_score, update_available, created_at, updated_at',
      )
      .eq('workspace_id', workspaceId)
      .order('category')
      .order('path');

    if (category) {
      query = query.eq('category', category);
    }
    if (enabledOnly) {
      query = query.eq('is_enabled', true);
    }
    if (installSource) {
      query = query.eq('install_source', installSource);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[skills] Query error:', error);
      return NextResponse.json({ error: 'Failed to load skills' }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;
  const rateLimitResult = await applyRateLimit(request, 'skills.create', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
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

    const parsed = createSkillSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join('; ');
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const {
      workspace_id,
      path,
      category,
      tier,
      description,
      tags,
      install_source,
      content,
      version,
    } = parsed.data;

    const forbidden = await requireWorkspaceMembership(userId, workspace_id);
    if (forbidden) return forbidden;

    // BYO skills must pass quality gate before creation
    if (install_source === 'byo' && content) {
      const validation = validateBYOSkill(content, { path, category });
      if (!meetsQualityGate(validation)) {
        return NextResponse.json(
          {
            error: 'Skill does not meet quality requirements',
            validation: {
              ...validation,
              min_quality_score: MIN_QUALITY_SCORE,
            },
          },
          { status: 422 },
        );
      }
    }

    const contentHash = computeContentHash(content ?? '');

    // Service client: inserts a skill into brain_manifest. Accesses: brain_manifest.
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('brain_manifest')
      .upsert(
        {
          workspace_id,
          path,
          category,
          tier,
          description: description ?? null,
          tags,
          install_source,
          content_hash: contentHash,
          version,
          is_core: install_source === 'bootstrap',
          is_forked: false,
          is_enabled: true,
          ownership_scope: install_source === 'byo' ? 'workspace' : 'core',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,path' },
      )
      .select('id, path, category, tier, description, tags, install_source, is_enabled')
      .single();

    if (error) {
      console.error('[skills] Insert error:', error);
      return NextResponse.json({ error: 'Failed to create skill' }, { status: 500 });
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
