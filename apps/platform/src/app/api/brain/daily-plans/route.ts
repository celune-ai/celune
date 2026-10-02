/**
 * Daily Plans endpoint — bidirectional sync between vault and platform.
 *
 * GET  /api/brain/daily-plans?workspace_id=<id>&date=<YYYY-MM-DD>  — get plan for date
 * POST /api/brain/daily-plans  { workspace_id, date, content, task_ids? }  — store/update plan
 *
 * Plans are stored as agent_memory entries with source='daily-plan' and
 * category='daily-plan', keyed by date for upsert semantics.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_READ, RATE_WRITE } from '@/lib/rate-limiter';
import { fireAndForgetEmbedding } from '@/lib/memory-helpers';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z.object({
  workspace_id: z.string().uuid(),
  date: z.string().regex(DATE_REGEX, 'Date must be YYYY-MM-DD format'),
  content: z.string().min(1).max(50_000),
  task_ids: z.array(z.string().uuid()).max(50).optional(),
});

export async function GET(request: NextRequest) {
  const rateLimitGet = await applyRateLimit(request, 'brain.daily-plans.get', RATE_READ);
  if (rateLimitGet) return rateLimitGet.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId || !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Valid workspace_id is required' }, { status: 400 });
    }

    const date = request.nextUrl.searchParams.get('date');

    const forbidden = await requireWorkspaceMembership(userId, workspaceId);
    if (forbidden) return forbidden;

    const supabase = createServiceClient();

    let query = supabase
      .from('agent_memory')
      .select('id, key, content, metadata, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('source', 'daily-plan')
      .eq('category', 'daily-plan')
      .order('created_at', { ascending: false });

    if (date && DATE_REGEX.test(date)) {
      // Single date lookup
      query = query.eq('key', `daily-plan:${workspaceId}:${date}`);
    } else {
      // List recent plans (last 30)
      query = query.limit(30);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[daily-plans] Query error:', error);
      return NextResponse.json({ error: 'Failed to load daily plans' }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;
  const rateLimitResult = await applyRateLimit(request, 'brain.daily-plans.create', RATE_WRITE);
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

    const parsed = createSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join('; ');
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const { workspace_id, date, content, task_ids } = parsed.data;

    const forbidden = await requireWorkspaceMembership(userId, workspace_id);
    if (forbidden) return forbidden;

    const supabase = createServiceClient();

    const memoryRow = {
      key: `daily-plan:${workspace_id}:${date}`,
      content,
      category: 'daily-plan',
      memory_type: 'context',
      source: 'daily-plan',
      importance_score: 0.6,
      workspace_id,
      is_archived: false,
      is_core: false,
      tags: ['daily-plan', 'vault-sync'],
      metadata: {
        date,
        task_ids: task_ids ?? [],
        synced_from: 'platform',
        synced_at: new Date().toISOString(),
      },
    };

    const { data, error } = await supabase
      .from('agent_memory')
      .upsert(memoryRow, { onConflict: 'key' })
      .select('id, key, content, metadata, created_at, updated_at')
      .single();

    if (error) {
      console.error('[daily-plans] Upsert error:', error);
      return NextResponse.json({ error: 'Failed to store daily plan' }, { status: 500 });
    }

    // Fire-and-forget embedding for the plan content
    if (data) {
      fireAndForgetEmbedding(supabase, data.id, content);
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
