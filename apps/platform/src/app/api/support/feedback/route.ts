import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { applyRateLimit, RATE_READ, RATE_WRITE } from '@/lib/rate-limiter';
import { createFeedbackSchema, updateFeedbackSchema } from '@/lib/schemas/feedback.schema';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

/**
 * GET /api/support/feedback?workspace_id=...&status=...&limit=50
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const workspaceId = searchParams.get('workspace_id');

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
  }

  const permResult = await requirePermission(request, workspaceId, 'settings:manage');
  if (permResult instanceof NextResponse) return permResult;

  const rateLimitResult = await applyRateLimit(request, 'support.feedback.read', RATE_READ);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const limit = Math.min(Number(searchParams.get('limit') ?? 50), 200);
    const offset = Number(searchParams.get('offset') ?? 0);

    const supabase = createServiceClient();

    let query = supabase
      .from('feedback')
      .select(
        'id, workspace_id, user_id, name, email, subject, message, type, rating, category, priority, status, screenshot_url, page_url, user_agent, internal_notes, claimed_by, claimed_at, resolved_at, created_at, updated_at',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (workspaceId) query = query.eq('workspace_id', workspaceId);
    if (status) query = query.eq('status', status);
    if (type) query = query.eq('type', type);

    const { data, error, count } = await query;
    if (error) throw error;

    return NextResponse.json({ data: data ?? [], total: count ?? 0 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * POST /api/support/feedback?workspace_id=...
 */
type CreateFeedbackBody = z.infer<typeof createFeedbackSchema>;

export const POST = withApiSecurity<CreateFeedbackBody>(
  async (request: NextRequest, { userId, body }: SecurityContext<CreateFeedbackBody>) => {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');

    const {
      name,
      email,
      subject,
      message,
      type,
      rating,
      category,
      priority,
      screenshot_url,
      page_url,
      user_agent,
    } = body;

    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('feedback')
      .insert({
        name: name ?? null,
        email,
        subject,
        message,
        type: type ?? 'general',
        rating: rating ?? null,
        category: category ?? 'general',
        priority: priority ?? 'normal',
        screenshot_url: screenshot_url ?? null,
        page_url: page_url ?? null,
        user_agent: user_agent ?? null,
        user_id: userId,
        workspace_id: workspaceId ?? null,
        status: 'new',
      })
      .select('id, created_at')
      .single();

    if (error) throw error;

    return NextResponse.json(
      { success: true, feedback_id: data.id, message: 'Thank you for your feedback!' },
      { status: 201 },
    );
  },
  {
    permission: 'tasks:read',
    rateLimit: { tier: RATE_WRITE, routeKey: 'support.feedback.create' },
    parseBody: createFeedbackSchema,
    enforcePaywall: false,
  },
);

/**
 * PATCH /api/support/feedback?id=...
 */
type UpdateFeedbackBody = z.infer<typeof updateFeedbackSchema>;

export const PATCH = withApiSecurity<UpdateFeedbackBody>(
  async (request: NextRequest, { body }: SecurityContext<UpdateFeedbackBody>) => {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    const { id, status, internal_notes } = body;

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status) {
      update.status = status;
      if (status === 'actioned') update.resolved_at = new Date().toISOString();
    }
    if (internal_notes !== undefined) update.internal_notes = internal_notes;
    if (body.claimed_by !== undefined) {
      update.claimed_by = body.claimed_by;
      update.claimed_at = body.claimed_by ? new Date().toISOString() : null;
    }

    const { error } = await supabase
      .from('feedback')
      .update(update)
      .eq('id', id)
      .eq('workspace_id', workspaceId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  },
  {
    permission: 'settings:manage',
    rateLimit: { tier: RATE_WRITE, routeKey: 'support.feedback.patch' },
    parseBody: updateFeedbackSchema,
    enforcePaywall: false,
  },
);
