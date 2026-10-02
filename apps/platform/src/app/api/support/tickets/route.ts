import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { createSupportTicketSchema } from '@/lib/schemas/support.schema';
import { updateTicketStatusSchema } from '@/lib/schemas/feedback.schema';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

/**
 * GET /api/support/tickets?workspace_id=...&status=open&limit=50
 * List support tickets for a workspace. Requires tickets:read or workspace:manage permission.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const workspaceId = searchParams.get('workspace_id');

  const permResult = await requirePermission(request, workspaceId, 'settings:manage');
  if (permResult instanceof NextResponse) return permResult;

  const rateLimitResult = await applyRateLimit(request, 'support.tickets.read', RATE_READ);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const status = searchParams.get('status');
    const category = searchParams.get('category');
    const limit = Math.min(Number(searchParams.get('limit') ?? 50), 200);
    const offset = Number(searchParams.get('offset') ?? 0);

    // Service client: admin reads all workspace support tickets. Accesses: support_tickets.
    const supabase = createServiceClient();

    let query = supabase
      .from('support_tickets')
      .select(
        'id, workspace_id, user_id, org_id, name, email, subject, message, category, priority, status, resolved_at, created_at, updated_at',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (workspaceId) query = query.eq('workspace_id', workspaceId);
    if (status) query = query.eq('status', status);
    if (category) query = query.eq('category', category);

    const { data, error, count } = await query;
    if (error) throw error;

    return NextResponse.json({ data: data ?? [], total: count ?? 0 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * POST /api/support/tickets
 * Create a support ticket from an authenticated user.
 * Inherits user_id and workspace context from session.
 */
type CreateTicketBody = z.infer<typeof createSupportTicketSchema>;

export const POST = withApiSecurity<CreateTicketBody>(
  async (request: NextRequest, { userId, body }: SecurityContext<CreateTicketBody>) => {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');

    const { name, email, subject, message, category, priority, org_id } = body;

    // Service client: authenticated ticket creation — inserts on behalf of user. Accesses: support_tickets.
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('support_tickets')
      .insert({
        name,
        email,
        subject,
        message,
        category,
        priority,
        user_id: userId,
        org_id: org_id ?? null,
        workspace_id: workspaceId ?? null,
        status: 'open',
      })
      .select('id, created_at')
      .single();

    if (error) throw error;

    return NextResponse.json(
      {
        success: true,
        ticket_id: data.id,
        message: "Your ticket has been submitted. We'll get back to you within 1–2 business days.",
      },
      { status: 201 },
    );
  },
  {
    permission: 'tasks:read',
    rateLimit: { tier: RATE_WRITE, routeKey: 'support.tickets.create' },
    parseBody: createSupportTicketSchema,
    enforcePaywall: false,
  },
);

/**
 * PATCH /api/support/tickets
 * Update a ticket's status. Requires settings:manage permission.
 */
type UpdateTicketBody = z.infer<typeof updateTicketStatusSchema>;

export const PATCH = withApiSecurity<UpdateTicketBody>(
  async (request: NextRequest, { body }: SecurityContext<UpdateTicketBody>) => {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    const { id, status } = body;

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (status === 'resolved') update.resolved_at = new Date().toISOString();

    const { error } = await supabase
      .from('support_tickets')
      .update(update)
      .eq('id', id)
      .eq('workspace_id', workspaceId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  },
  {
    permission: 'settings:manage',
    rateLimit: { tier: RATE_WRITE, routeKey: 'support.tickets.patch' },
    parseBody: updateTicketStatusSchema,
    enforcePaywall: false,
  },
);
