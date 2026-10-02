import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { getAgentMemoryEntries } from '@repo/db/queries';
import type { MemoryCategory } from '@repo/types';
import { safeErrorResponse } from '@/lib/api-error';
import { enforcePlanLimit } from '@/lib/plan-enforcement';
import { extractWorkspaceScope, requireWorkspaceMembership } from '@/lib/require-workspace';
import { createMemorySchema } from '@/lib/schemas/memory.schema';
import { validateOrigin } from '@/lib/csrf';
import { parseBody, isErrorResponse } from '@/lib/parse-body';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { generateAbstract, fireAndForgetEmbedding } from '@/lib/memory-helpers';
import { detectAndCreateRelations } from '@/lib/auto-relations';
import { redactPii } from '@/lib/guardrails';
export const dynamic = 'force-dynamic';

const MAX_PAGE_LIMIT = 100;

export async function GET(request: NextRequest) {
  try {
    // Workspace scope is required for memory entry list queries
    const wsScope = extractWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Verify membership for each workspace in the scope
    const wsIds = 'workspace_ids' in wsScope ? wsScope.workspace_ids! : [wsScope.workspace_id!];
    for (const wsId of wsIds) {
      const membershipError = await requireWorkspaceMembership(user.id, wsId);
      if (membershipError) return membershipError;
    }

    const searchParams = request.nextUrl.searchParams;
    const category = (searchParams.get('category') ?? undefined) as MemoryCategory | undefined;
    const source = searchParams.get('source') ?? undefined;
    const rawLimit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;
    const limit =
      rawLimit !== undefined ? Math.min(Math.max(1, rawLimit), MAX_PAGE_LIMIT) : undefined;
    const rawOffset = searchParams.get('offset') ? Number(searchParams.get('offset')) : undefined;
    const offset =
      rawOffset !== undefined && !Number.isNaN(rawOffset) ? Math.max(0, rawOffset) : undefined;
    const include_archived = searchParams.get('include_archived') === 'true';

    const result = await getAgentMemoryEntries(supabase, {
      category,
      source,
      limit,
      offset,
      include_archived,
      ...wsScope,
    });
    return NextResponse.json(result);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'memory.entries.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = await parseBody(request, createMemorySchema);
    if (isErrorResponse(parsed)) return parsed;

    const {
      key,
      content,
      source,
      tags,
      category,
      workspace_id,
      agent_id,
      memory_type,
      importance_score,
      related_to,
    } = parsed;

    // PII redaction before storage (sync — cheap)
    const sanitizedContent = redactPii(content);
    const abstract = generateAbstract(sanitizedContent);

    // Parallelize: plan limit check + dedup check (both are independent reads)
    const [planBlocked, dedupResult] = await Promise.all([
      workspace_id
        ? enforcePlanLimit({ workspaceId: String(workspace_id), userId: user.id }, 'memories')
        : Promise.resolve(null),
      workspace_id && key
        ? supabase
            .from('agent_memory')
            .select('id, key, content')
            .eq('workspace_id', workspace_id)
            .eq('user_id', user.id)
            .eq('key', key)
            .eq('is_archived', false)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    if (planBlocked) return planBlocked;

    const row = {
      key,
      content: sanitizedContent,
      category: category ?? 'general',
      source: source ?? 'app',
      memory_type: memory_type ?? 'context',
      tags: tags ?? '',
      importance_score:
        importance_score != null
          ? importance_score > 1
            ? importance_score / 100
            : importance_score
          : 0.5,
      user_id: user.id,
      workspace_id: workspace_id ?? null,
      agent_id: agent_id ?? null,
    };

    // Dedup: if same key exists in workspace, merge content instead of creating duplicate
    if (workspace_id && key) {
      const existing = dedupResult?.data ?? null;

      if (existing) {
        // Same key exists — update content instead of creating duplicate
        const merged =
          existing.content === sanitizedContent
            ? sanitizedContent
            : `${existing.content}\n\n---\n\n${sanitizedContent}`;
        const mergedAbstract = generateAbstract(merged);
        const { data: updated, error: updateErr } = await supabase
          .from('agent_memory')
          .update({
            content: merged,
            abstract: mergedAbstract,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .select('id, key')
          .single();
        if (updateErr) return safeErrorResponse(updateErr);

        // Regenerate embedding for merged content (fire-and-forget)
        fireAndForgetEmbedding(supabase, updated!.id, merged);

        return NextResponse.json(
          { ...updated, dedup: 'merged' },
          { status: 200, headers: { 'X-Memory-Dedup': 'merged' } },
        );
      }
    }

    const { data, error } = await supabase
      .from('agent_memory')
      .insert({ ...row, abstract })
      .select('id, key')
      .single();
    if (error) return safeErrorResponse(error);

    // Generate embedding (fire-and-forget) — uses sanitized content
    fireAndForgetEmbedding(supabase, data.id, sanitizedContent);

    // Create relations if provided (fire-and-forget)
    if (related_to && related_to.length > 0 && workspace_id) {
      const relations = related_to.map((r) => ({
        memory_id: data.id,
        related_type: r.type,
        related_id: r.id,
        relation_type: r.relation_type ?? 'elaborates',
        confidence: r.confidence ?? 1.0,
        workspace_id,
      }));
      void supabase.from('memory_relations').upsert(relations, {
        onConflict: 'memory_id,related_type,related_id,relation_type',
      });
    }

    // Auto-detect relations (fire-and-forget)
    if (workspace_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      detectAndCreateRelations(supabase as any, {
        memoryId: data.id,
        key,
        content: sanitizedContent,
        category: category ?? 'general',
        workspaceId: String(workspace_id),
        userId: user.id,
      });
    }

    return NextResponse.json(
      { ...data, dedup: 'created' },
      { status: 201, headers: { 'X-Memory-Dedup': 'created' } },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
