import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@repo/db/server';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

const RELATION_TYPES = [
  'supports',
  'contradicts',
  'supersedes',
  'elaborates',
  'depends_on',
  'derived_from',
  'context_for',
] as const;

const createRelationSchema = z.object({
  related_type: z.enum(['task', 'skill', 'memory']),
  related_id: z.string().uuid(),
  relation_type: z.enum(RELATION_TYPES).default('elaborates'),
  confidence: z.number().min(0).max(1).default(1.0).optional(),
});

/**
 * GET /api/memory/entries/[id]/relations
 * Returns all relations for a memory entry.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid memory entry ID' }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Verify memory exists and user owns it
    const { data: memory } = await supabase
      .from('agent_memory')
      .select('id, workspace_id')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!memory) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { data, error } = await supabase
      .from('memory_relations')
      .select(
        'id, memory_id, related_type, related_id, relation_type, confidence, workspace_id, created_at',
      )
      .eq('memory_id', id)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    return NextResponse.json({ relations: data ?? [] });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * POST /api/memory/entries/[id]/relations
 * Create a relation between a memory and another entity.
 * Body: { related_type: 'task'|'skill'|'memory', related_id: uuid, relation_type?: string }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'memory.relations.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid memory entry ID' }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = await parseBody(request, createRelationSchema);
    if (isErrorResponse(parsed)) return parsed;

    const { related_type, related_id, relation_type, confidence } = parsed;

    // Verify memory exists and user owns it
    const { data: memory } = await supabase
      .from('agent_memory')
      .select('id, workspace_id')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!memory) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Verify related entity belongs to the same workspace
    if (memory.workspace_id) {
      const table =
        related_type === 'task' ? 'tasks' : related_type === 'skill' ? 'skills' : 'agent_memory';
      const { data: relatedEntity } = await supabase
        .from(table)
        .select('id')
        .eq('id', related_id)
        .eq('workspace_id', memory.workspace_id)
        .maybeSingle();
      if (!relatedEntity) {
        return NextResponse.json(
          { error: 'Related entity not found in workspace' },
          { status: 404 },
        );
      }
    }

    const { data, error } = await supabase
      .from('memory_relations')
      .upsert(
        {
          memory_id: id,
          related_type,
          related_id,
          relation_type: relation_type || 'elaborates',
          confidence: confidence ?? 1.0,
          workspace_id: memory.workspace_id,
        },
        { onConflict: 'memory_id,related_type,related_id,relation_type' },
      )
      .select(
        'id, memory_id, related_type, related_id, relation_type, confidence, workspace_id, created_at',
      )
      .single();

    if (error) throw error;

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * DELETE /api/memory/entries/[id]/relations?relation_id=<uuid>
 * Delete a specific relation from a memory entry.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResult = await applyRateLimit(request, 'memory.relations.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid memory entry ID' }, { status: 400 });
    }

    const relationId = request.nextUrl.searchParams.get('relation_id');
    if (!relationId || !isValidUuid(relationId)) {
      return NextResponse.json({ error: 'relation_id query param required' }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Verify memory exists and user owns it
    const { data: memory } = await supabase
      .from('agent_memory')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!memory) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Delete the relation (must belong to this memory)
    const { error } = await supabase
      .from('memory_relations')
      .delete()
      .eq('id', relationId)
      .eq('memory_id', id);

    if (error) throw error;

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
