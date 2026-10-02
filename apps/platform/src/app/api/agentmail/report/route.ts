import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePlatformOwner } from '@/lib/permissions';
import { safeErrorResponse } from '@/lib/api-error';
import {
  getAgentMailClient,
  AGENT_MAIL_DOMAIN,
  agentDisplayName,
  extractInboxEmail,
} from '@/lib/agentmail';
import { validateOrigin } from '@/lib/csrf';
import { agentmailReportSchema } from '@/lib/schemas/agentmail.schema';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

/** Escape HTML entities to prevent XSS in email content */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert basic markdown to HTML for email rendering (input is pre-escaped) */
function markdownToHtml(md: string): string {
  const escaped = escapeHtml(md);
  return escaped
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}

/**
 * POST /api/agentmail/report — Send a formatted report email from an agent
 *
 * Body: { from_agent: string, to: string, subject: string, markdown: string }
 *
 * Converts markdown to HTML and sends via the agent's AgentMail inbox.
 * Used by build skills, retros, closing-time summaries, etc.
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'agentmail.report.post', RATE_WRITE);
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

    const parsed = agentmailReportSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { from_agent, to, subject, markdown } = parsed.data;

    const client = getAgentMailClient();

    // Find the inbox for this agent
    const response = await client.inboxes.list();
    const agentEmail = `${from_agent}@${AGENT_MAIL_DOMAIN}`;
    const inbox = (response.inboxes ?? []).find(
      (ib) => extractInboxEmail(ib.displayName)?.toLowerCase() === agentEmail.toLowerCase(),
    );

    if (!inbox || !inbox.inboxId) {
      return NextResponse.json(
        { error: `No inbox found for ${from_agent}. Provision inboxes first.` },
        { status: 404 },
      );
    }

    const agentName = escapeHtml(agentDisplayName(from_agent));
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
        <div style="border-bottom: 2px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 24px;">
          <strong style="font-size: 14px; color: #6b7280;">${agentName}</strong>
        </div>
        <div style="line-height: 1.6; font-size: 15px;">
          ${markdownToHtml(markdown)}
        </div>
        <div style="border-top: 1px solid #e5e7eb; margin-top: 32px; padding-top: 16px; font-size: 12px; color: #9ca3af;">
          Sent by ${agentName} via Celune
        </div>
      </div>
    `;

    const recipients: string[] = Array.isArray(to) ? to : [to];
    const result = await client.inboxes.messages.send(inbox.inboxId, {
      to: recipients,
      subject,
      text: markdown,
      html,
    });

    return NextResponse.json({
      message_id: result.messageId ?? null,
      from: agentEmail,
      to: recipients,
      status: 'sent',
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
