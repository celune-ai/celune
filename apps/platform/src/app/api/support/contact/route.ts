import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { createSupportTicketSchema } from '@/lib/schemas/support.schema';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import { getAuthUserId } from '@/lib/auth';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

/**
 * POST /api/support/contact
 * Public-facing endpoint — no auth required.
 * Creates a support ticket for both authenticated and anonymous users.
 * Rate-limited by IP to prevent abuse.
 *
 * Security: user_id/org_id/workspace_id are derived from auth, NOT from body.
 * This prevents unauthenticated users from spoofing associations.
 */
type CreateContactBody = z.infer<typeof createSupportTicketSchema>;

export const POST = withApiSecurity<CreateContactBody>(
  async (request: NextRequest, { body }: SecurityContext<CreateContactBody>) => {
    const { name, email, subject, message, category, priority } = body;

    // Derive user/org/workspace from auth — never trust body values for these
    const authenticatedUserId = getAuthUserId(request);

    // Service client: public contact form — inserts ticket bypassing RLS. Accesses: support_tickets.
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
        user_id: authenticatedUserId ?? null,
        org_id: null,
        workspace_id: null,
        status: 'open',
      })
      .select('id, created_at')
      .single();

    if (error) throw error;

    return NextResponse.json(
      {
        success: true,
        ticket_id: data.id,
        message: "Your message has been received. We'll get back to you within 1–2 business days.",
      },
      { status: 201 },
    );
  },
  {
    requireAuth: false,
    rateLimit: { tier: { limit: 5, windowMs: 10 * 60_000 }, routeKey: 'support.contact' },
    parseBody: createSupportTicketSchema,
  },
);
