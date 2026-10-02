import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { getAuthUserId } from '@/lib/auth';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_READ, RATE_WRITE } from '@/lib/rate-limiter';

const UpdateSourceSchema = z.object({
  display_name: z.string().min(1).max(200).optional(),
  sync_frequency_hours: z.number().int().min(1).max(168).optional(),
  status: z.enum(['active', 'paused']).optional(),
});

export const dynamic = 'force-dynamic';

/** Fetch source and verify workspace membership. Returns source or error response. */
async function getSourceWithAuth(request: NextRequest, sourceId: string) {
  const userId = getAuthUserId(request);
  if (!userId) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (!isValidUuid(sourceId)) {
    return { error: NextResponse.json({ error: 'Invalid source ID' }, { status: 400 }) };
  }

  const supabase = createServiceClient();
  const { data: source, error } = await supabase
    .from('knowledge_sources')
    .select('*')
    .eq('id', sourceId)
    .single();

  if (error || !source) {
    return { error: NextResponse.json({ error: 'Knowledge source not found' }, { status: 404 }) };
  }

  const membershipError = await requireWorkspaceMembership(userId, source.workspace_id);
  if (membershipError) return { error: membershipError };

  return { source, userId, supabase };
}

/**
 * GET /api/knowledge/sources/[id]
 * Get source detail with recent sync history (last 10 syncs).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'knowledge.sources.id.get', RATE_READ);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const { id } = await params;
    const result = await getSourceWithAuth(request, id);
    if ('error' in result) return result.error;

    const { source, supabase } = result;

    // Fetch last 10 sync records
    const { data: syncs } = await supabase
      .from('knowledge_syncs')
      .select('id, status, items_synced, items_failed, started_at, completed_at, error_message')
      .eq('source_id', id)
      .order('started_at', { ascending: false })
      .limit(10);

    return NextResponse.json({
      ...source,
      recent_syncs: syncs ?? [],
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * PATCH /api/knowledge/sources/[id]
 * Update source: display_name, sync_frequency_hours, status (pause/resume).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'knowledge.sources.id.patch', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  try {
    const { id } = await params;
    const result = await getSourceWithAuth(request, id);
    if ('error' in result) return result.error;

    const { supabase } = result;
    const rawBody = await request.json();
    const parseResult = UpdateSourceSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0]?.message ?? 'Invalid request body' },
        { status: 400 },
      );
    }

    // Build update payload from validated fields
    const allowedFields: Record<string, unknown> = {};
    const validated = parseResult.data;
    if (validated.display_name !== undefined) allowedFields.display_name = validated.display_name;
    if (validated.sync_frequency_hours !== undefined)
      allowedFields.sync_frequency_hours = validated.sync_frequency_hours;
    if (validated.status !== undefined) allowedFields.status = validated.status;

    if (Object.keys(allowedFields).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    allowedFields.updated_at = new Date().toISOString();

    const { data: updated, error } = await supabase
      .from('knowledge_sources')
      .update(allowedFields)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(updated);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * DELETE /api/knowledge/sources/[id]
 * Disconnect source — cascade deletes all knowledge_items for this source.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResult = await applyRateLimit(request, 'knowledge.sources.id.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  try {
    const { id } = await params;
    const result = await getSourceWithAuth(request, id);
    if ('error' in result) return result.error;

    const { supabase } = result;

    // Delete all knowledge items for this source first
    const { error: itemsError } = await supabase
      .from('knowledge_items')
      .delete()
      .eq('source_id', id);

    if (itemsError) throw itemsError;

    // Delete all sync records
    const { error: syncsError } = await supabase
      .from('knowledge_syncs')
      .delete()
      .eq('source_id', id);

    if (syncsError) throw syncsError;

    // Delete the source
    const { error: sourceError } = await supabase.from('knowledge_sources').delete().eq('id', id);

    if (sourceError) throw sourceError;

    return NextResponse.json({ deleted: true }, { status: 200 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
