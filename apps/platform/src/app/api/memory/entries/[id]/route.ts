import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { memoryContentSchema } from '@/lib/schemas/memory.schema';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { generateAbstract, fireAndForgetEmbedding } from '@/lib/memory-helpers';
export const dynamic = 'force-dynamic';

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

    const { data, error } = await supabase
      .from('agent_memory')
      .select(
        'id, key, content, abstract, category, memory_type, source, tags, importance_score, workspace_id, agent_id, user_id, is_archived, is_core, created_at, updated_at',
      )
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json(data);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'memory.entries.id.patch', RATE_WRITE);
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

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = memoryContentSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    // Only allow updating user-owned memories; system/core source is read-only
    const { data: existing, error: fetchError } = await supabase
      .from('agent_memory')
      .select('id, source, user_id, is_core, category')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (existing.is_core) {
      return NextResponse.json({ error: 'Core memories are read-only' }, { status: 403 });
    }
    if (existing.source === 'system') {
      return NextResponse.json({ error: 'System memories are read-only' }, { status: 403 });
    }
    if (existing.category === 'episode') {
      return NextResponse.json(
        { error: 'Episode memories are immutable and cannot be updated' },
        { status: 403 },
      );
    }

    const { content, category, tags, is_archived } = parsed.data;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (content !== undefined) {
      updates.content = content;
      // Regenerate abstract when content changes
      updates.abstract = generateAbstract(content);
    }
    if (category !== undefined) updates.category = category;
    if (tags !== undefined) updates.tags = tags;
    if (is_archived !== undefined) updates.is_archived = is_archived;

    const { data, error } = await supabase
      .from('agent_memory')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select(
        'id, key, content, abstract, category, memory_type, source, tags, importance_score, workspace_id, agent_id, user_id, is_archived, is_core, created_at, updated_at',
      )
      .single();

    if (error) throw error;

    // Regenerate embedding if content changed (fire-and-forget)
    if (content !== undefined) {
      fireAndForgetEmbedding(supabase, id, content);
    }

    return NextResponse.json(data);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResult = await applyRateLimit(request, 'memory.entries.id.delete', RATE_WRITE);
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

    // Check exists and user owns it; block system and core memories
    const { data: existing, error: fetchError } = await supabase
      .from('agent_memory')
      .select('id, source, user_id, is_core')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (existing.is_core) {
      return NextResponse.json({ error: 'Cannot delete core memories' }, { status: 403 });
    }
    if (existing.source === 'system') {
      return NextResponse.json({ error: 'System memories cannot be deleted' }, { status: 403 });
    }

    const { error } = await supabase
      .from('agent_memory')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
