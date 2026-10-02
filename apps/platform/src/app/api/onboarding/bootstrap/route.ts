import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { z } from 'zod';
import { getManifestForTier, computeContentHash } from '@repo/db/brain-manifest-registry';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { validateOrigin } from '@/lib/csrf';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

/** Resolve a brain file path and verify it doesn't escape the base directory. */
function safeBrainPath(baseDir: string, filePath: string): string | null {
  // Only allow alphanumeric, forward slashes, dots, hyphens, underscores
  if (!/^[a-zA-Z0-9/_.-]+$/.test(filePath)) return null;
  const resolved = resolve(baseDir, filePath);
  const resolvedBase = resolve(baseDir);
  if (!resolved.startsWith(resolvedBase + '/') && resolved !== resolvedBase) return null;
  return resolved;
}

const bootstrapSchema = z.object({
  workspace_id: z.string().uuid(),
  use_case: z
    .enum(['web-app', 'mobile', 'ai-ml', 'content', 'fullstack', 'other'])
    .default('other'),
  autonomy: z.enum(['solo', 'supervised', 'autonomous']).default('supervised'),
  tdd_preference: z.enum(['off', 'advisory', 'strict']).default('advisory'),
  tech_stack: z.array(z.string().max(50)).max(5).default([]),
  team_size: z.enum(['solo', 'small', 'growing', 'large']).default('solo'),
  notifications: z.array(z.string().max(20)).max(3).default(['in-app']),
});

/**
 * POST /api/onboarding/bootstrap
 *
 * Stores the onboarding questionnaire answers as workspace metadata
 * and seeds corresponding agent memories for brain configuration.
 *
 * The actual CLI-side bootstrap (file generation) reads this metadata
 * via the workspace API and generates .claude/ files locally.
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'onboarding.bootstrap.post', RATE_WRITE);
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

    const parsed = bootstrapSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join('; ');
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const {
      workspace_id,
      use_case,
      autonomy,
      tdd_preference,
      tech_stack,
      team_size,
      notifications,
    } = parsed.data;

    // Service client: reads workspace membership, updates workspace metadata, inserts memories.
    const supabase = createServiceClient();

    // Verify user is a member of this workspace
    const { data: membership } = await supabase
      .from('workspace_memberships')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('workspace_id', workspace_id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 });
    }

    // Store brain config in workspace metadata
    const brainConfig = {
      use_case,
      autonomy,
      tdd_preference,
      tech_stack,
      team_size,
      notifications,
      bootstrap_completed_at: new Date().toISOString(),
      bootstrap_version: '1.0.0',
    };

    // Read existing metadata to avoid clobbering other fields
    const { data: existingWorkspace } = await supabase
      .from('workspaces')
      .select('metadata')
      .eq('id', workspace_id)
      .single();

    const existingMetadata = (existingWorkspace?.metadata as Record<string, unknown>) ?? {};

    const { error: updateError } = await supabase
      .from('workspaces')
      .update({
        metadata: { ...existingMetadata, brain_config: brainConfig },
        updated_at: new Date().toISOString(),
      })
      .eq('id', workspace_id);

    if (updateError) {
      console.error('[bootstrap] Failed to update workspace metadata:', updateError);
      return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 });
    }

    // Store key preferences as agent memories for persistence
    const memories = [
      // --- Platform knowledge (so the IDE can answer "what is Celune / my second brain?") ---
      {
        key: 'platform:what-is-celune',
        content:
          'Celune is an AI-native workspace platform. It gives you a team of AI agents that manage tasks, projects, memory, and integrations. Your agents work through your IDE via MCP (Model Context Protocol) — they can read and write tasks, recall memories, and coordinate work. Think of it as your second brain: a persistent, searchable knowledge layer that your AI tools can tap into.',
        category: 'context',
        source: 'onboarding',
        workspace_id,
        agent_id: 'system',
        importance_score: 1.0,
      },
      {
        key: 'platform:second-brain',
        content:
          'Your "second brain" is the agent memory system in Celune. It stores facts, preferences, decisions, and context as searchable memory entries. Memories are created automatically during conversations and task completion, or manually via the store_memory tool. You can search memories with recall_memory (semantic search) or list_memories (by category). Categories: preference, decision, context, fact, general, handoff.',
        category: 'context',
        source: 'onboarding',
        workspace_id,
        agent_id: 'system',
        importance_score: 1.0,
      },
      {
        key: 'platform:available-tools',
        content:
          'Celune MCP tools available in your IDE: list_tasks, get_task, create_task, claim_task, complete_task, block_task, add_comment (task management); list_projects, get_project (project management); recall_memory, list_memories, store_memory (memory/knowledge); whoami, get_workspace_info (workspace context). Use these tools to interact with your Celune workspace directly from your editor.',
        category: 'context',
        source: 'onboarding',
        workspace_id,
        agent_id: 'system',
        importance_score: 0.95,
      },
      {
        key: 'platform:onboarding-status',
        content:
          'This workspace is being set up. The user is going through onboarding — a conversation to learn about their goals, working style, and needs. Memories are being saved in real-time as the conversation progresses. After onboarding, a personalized agent team and profile will be generated.',
        category: 'context',
        source: 'onboarding',
        workspace_id,
        agent_id: 'system',
        importance_score: 0.9,
      },
      {
        key: 'platform:mcp-during-onboarding',
        content:
          "During onboarding, some MCP tools may not be fully available yet. This is normal — the Celune MCP server requires authentication and a completed workspace setup before exposing its full tool set (tasks, projects, memory, etc.). If your IDE shows limited tools or asks you to authenticate, that will resolve once onboarding is finished. After onboarding completes, restart or refresh your IDE's MCP connection and all Celune tools will be available. Your second brain (agent memory system) will be fully accessible at that point — you can store memories, search knowledge, manage tasks, and more directly from your editor.",
        category: 'context',
        source: 'onboarding',
        workspace_id,
        agent_id: 'system',
        importance_score: 0.95,
      },
      // --- User-specific config ---
      {
        key: 'brain-config:use-case',
        content: `Use case: ${use_case}. This workspace is configured for ${use_case} development.`,
        category: 'context',
        source: 'onboarding',
        workspace_id,
        agent_id: 'system',
        importance_score: 0.9,
      },
      {
        key: 'brain-config:autonomy',
        content: `Autonomy preference: ${autonomy}. ${
          autonomy === 'autonomous'
            ? 'Agents act freely and report results.'
            : autonomy === 'solo'
              ? 'User drives all decisions.'
              : 'Agents act but check on important decisions.'
        }`,
        category: 'preference',
        source: 'onboarding',
        workspace_id,
        agent_id: 'system',
        importance_score: 0.85,
      },
      {
        key: 'brain-config:tech-stack',
        content: `Tech stack: ${tech_stack.length > 0 ? tech_stack.join(', ') : 'Not specified'}`,
        category: 'context',
        source: 'onboarding',
        workspace_id,
        agent_id: 'system',
        importance_score: 0.8,
      },
    ];

    // Upsert memories (don't fail if some already exist)
    for (const mem of memories) {
      await supabase.from('agent_memory').upsert(mem, { onConflict: 'key,workspace_id' });
    }

    // -----------------------------------------------------------------------
    // Seed brain_manifest rows for the workspace
    // -----------------------------------------------------------------------
    // All users get the full brain — no tier gating.
    console.info(`[bootstrap] Seeding brain manifest: full brain, workspace=${workspace_id}`);
    const manifestEntries = getManifestForTier();
    const now = new Date().toISOString();

    // Compute real content hashes from core brain files
    const coreBrainDir = join(process.cwd(), '..', '..', 'packages', 'brain', 'core');

    const manifestRows = manifestEntries.map((entry) => {
      let contentHash = computeContentHash('');
      try {
        const coreFilePath = safeBrainPath(coreBrainDir, entry.path);
        if (coreFilePath && !entry.path.endsWith('/') && existsSync(coreFilePath)) {
          const content = readFileSync(coreFilePath, 'utf8');
          contentHash = computeContentHash(content);
        }
      } catch {
        // Fall back to empty hash
      }
      return {
        workspace_id,
        path: entry.path,
        content_hash: contentHash,
        version: entry.version,
        tier: entry.tier,
        category: entry.category,
        description: entry.description,
        tags: [] as string[],
        is_core: entry.isCore,
        is_forked: false,
        is_enabled: true,
        install_source: 'bootstrap' as const,
        ownership_scope: 'core' as const,
        update_available: false,
        update_summary: null,
        created_at: now,
        updated_at: now,
      };
    });

    let manifestSeeded = 0;
    if (manifestRows.length > 0) {
      const { error: manifestError, count } = await supabase
        .from('brain_manifest')
        .upsert(manifestRows, {
          onConflict: 'workspace_id,path',
          count: 'exact',
        });

      if (manifestError) {
        // Non-fatal — log and continue. The workspace is still usable without manifest rows.
        console.error('[bootstrap] Failed to seed brain_manifest:', manifestError);
      } else {
        manifestSeeded = count ?? manifestRows.length;
      }
    }

    // -----------------------------------------------------------------------
    // Auto-install recommended skill packs based on team type
    // -----------------------------------------------------------------------
    let packsInstalled = 0;
    try {
      // Find packs with affinity for this team's use_case, sorted by priority
      const { data: recommendedPacks } = await supabase
        .from('skill_packs')
        .select('id, slug, version, team_type_affinity')
        .eq('is_published', true);

      if (recommendedPacks && recommendedPacks.length > 0) {
        // Sort by affinity score for this use_case (lower = higher priority)
        const sortedPacks = recommendedPacks
          .filter((p) => {
            const affinity = (p.team_type_affinity as Record<string, number>)?.[use_case];
            return affinity !== undefined && affinity <= 2; // Only auto-install high-affinity packs
          })
          .sort((a, b) => {
            const aScore = (a.team_type_affinity as Record<string, number>)?.[use_case] ?? 99;
            const bScore = (b.team_type_affinity as Record<string, number>)?.[use_case] ?? 99;
            return aScore - bScore;
          });

        for (const pack of sortedPacks) {
          const { error: installErr } = await supabase.from('skill_pack_installs').upsert(
            {
              workspace_id,
              skill_pack_id: pack.id,
              installed_by: userId,
              version_installed: pack.version,
            },
            { onConflict: 'workspace_id,skill_pack_id' },
          );

          if (!installErr) {
            packsInstalled++;
          }
        }
      }
    } catch {
      // Non-fatal — skill pack auto-install is a nice-to-have
      console.error('[bootstrap] Skill pack auto-install failed (non-fatal)');
    }

    return NextResponse.json({
      ok: true,
      brain_config: brainConfig,
      memories_stored: memories.length,
      manifest: {
        tier: 'full',
        seeded: manifestSeeded,
        total_entries: manifestEntries.length,
      },
      skill_packs: {
        auto_installed: packsInstalled,
      },
    });
  } catch (error) {
    console.error('[bootstrap] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/onboarding/bootstrap?workspace_id=<uuid>
 *
 * Returns the brain configuration for a workspace.
 * Used by the CLI bootstrap script to read config before generating files.
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

    // Get workspace with brain config
    const { data: workspace, error } = await supabase
      .from('workspaces')
      .select('id, name, slug, metadata')
      .eq('id', workspaceId)
      .single();

    if (error || !workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const metadata = workspace.metadata as Record<string, unknown> | null;
    const brainConfig = metadata?.brain_config ?? null;

    return NextResponse.json({
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      workspace_slug: workspace.slug,
      brain_config: brainConfig,
      bootstrap_complete: !!brainConfig,
    });
  } catch (error) {
    console.error('[bootstrap] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
