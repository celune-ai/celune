import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePlatformOwner } from '@/lib/permissions';
import { safeErrorResponse } from '@/lib/api-error';
import { getAgentMailClient, AGENT_MAIL_DOMAIN, extractInboxEmail } from '@/lib/agentmail';
import { validateOrigin } from '@/lib/csrf';
import { agentmailSendSchema } from '@/lib/schemas/agentmail.schema';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

/** POST /api/agentmail/send — Send an email from an agent's inbox */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'agentmail.send.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const permResult = await requirePlatformOwner(request);
    if (permResult instanceof NextResponse) return permResult;

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = agentmailSendSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { agent_id, to, subject, body: emailBody, html } = parsed.data;

    const client = getAgentMailClient();

    // Find the inbox for this agent
    const response = await client.inboxes.list();
    const agentEmail = `${agent_id}@${AGENT_MAIL_DOMAIN}`;
    const inbox = (response.inboxes ?? []).find(
      (ib) => extractInboxEmail(ib.displayName)?.toLowerCase() === agentEmail.toLowerCase(),
    );

    if (!inbox || !inbox.inboxId) {
      return NextResponse.json(
        { error: `No inbox found for ${agent_id}. Provision inboxes first.` },
        { status: 404 },
      );
    }

    const recipients: string[] = Array.isArray(to) ? to : [to];
    const result = await client.inboxes.messages.send(inbox.inboxId, {
      to: recipients,
      subject,
      text: emailBody ?? '',
      html: html ?? undefined,
    });

    return NextResponse.json({ message_id: result.messageId ?? null, status: 'sent' });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
