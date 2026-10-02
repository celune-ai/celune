import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';

export const dynamic = 'force-dynamic';

const AGENTMAIL_WEBHOOK_SECRET = process.env['AGENTMAIL_WEBHOOK_SECRET'];

function verifySignature(payload: string, signature: string | null): boolean {
  if (!AGENTMAIL_WEBHOOK_SECRET) {
    console.error('[agentmail-webhook] AGENTMAIL_WEBHOOK_SECRET is not set');
    return false;
  }
  if (!signature) return false;

  const expected = crypto
    .createHmac('sha256', AGENTMAIL_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');

  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * POST /api/webhooks/agentmail — Receives AgentMail webhook events
 *
 * Events: message.received, message.sent, message.bounced, etc.
 * Logs events to activity_log for visibility in the admin activity feed.
 * Protected by HMAC signature verification via X-Webhook-Signature header.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-webhook-signature');

    if (!verifySignature(rawBody, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const eventType = body.type ?? body.event_type ?? 'unknown';
    const data = (body.data ?? body) as Record<string, unknown>;

    // Extract useful info from the event
    const inboxId = data.inbox_id ?? data.inboxId ?? null;
    const messageId = data.message_id ?? data.messageId ?? data.id ?? null;
    const fromVal = data.from as Record<string, unknown> | string | undefined;
    const from =
      (typeof fromVal === 'object' && fromVal !== null ? fromVal.email : fromVal) ?? null;
    const to = Array.isArray(data.to)
      ? data.to.map((r: { email?: string }) => r.email).join(', ')
      : (data.to ?? null);
    const subject = data.subject ?? null;

    // Service client: logs agentmail webhook events. Accesses: activity_log.
    const supabase = createServiceClient();
    const { error } = await supabase.from('activity_log').insert({
      event_type: `agentmail.${eventType}`,
      severity: eventType === 'message.bounced' ? 'warning' : 'info',
      source: 'agentmail-webhook',
      title: subject
        ? `Email ${eventType}: "${subject}" ${from ? `from ${from}` : ''}`
        : `AgentMail event: ${eventType}`,
      details: JSON.stringify({
        inbox_id: inboxId,
        message_id: messageId,
        from,
        to,
        subject,
        raw_event: eventType,
      }),
    });

    if (error) {
      console.error('Failed to log agentmail webhook:', error);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('AgentMail webhook error:', error);
    // Always return 200 to prevent AgentMail from retrying
    return NextResponse.json({ received: true, error: 'Processing failed' });
  }
}
