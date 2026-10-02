import { AgentMailClient } from 'agentmail';
import { markdownToHtml } from './markdown';
import type { AgentName, SendReportOptions, SendReportResult } from './types';

/**
 * Resolves the AgentMail inbox ID to send from.
 * Uses a single shared inbox (AGENTMAIL_FROM_INBOX) for all agents.
 * Falls back to per-agent inbox if AGENTMAIL_INBOX_{AGENT} is set.
 */
function resolveInboxId(agent: AgentName): string {
  // Shared inbox for all notifications (the shared support inbox ID)
  const shared = process.env['AGENTMAIL_FROM_INBOX'];
  if (shared) return shared;

  // Per-agent override
  const envKey = `AGENTMAIL_INBOX_${agent.toUpperCase()}`;
  return process.env[envKey] ?? `${agent}@${process.env['AGENTMAIL_DOMAIN'] ?? 'agentmail.to'}`;
}

/**
 * Send a structured email report from an agent to a recipient.
 *
 * Requires:
 *   AGENTMAIL_API_KEY  — AgentMail API key
 *   AGENTMAIL_DEFAULT_TO — default recipient email address
 *
 * Optional:
 *   AGENTMAIL_DOMAIN   — inbox domain (default: agentmail.to)
 *   AGENTMAIL_INBOX_{AGENT} — per-agent inbox address override
 *
 * @example
 * await sendAgentReport({
 *   from: "rick",
 *   subject: "Build Report: Auth System",
 *   markdown: "## Summary\nShipped PBKDF2 password hashing...",
 * });
 */
export async function sendAgentReport(opts: SendReportOptions): Promise<SendReportResult> {
  const apiKey = process.env['AGENTMAIL_API_KEY'];
  if (!apiKey) {
    return { ok: false, error: 'AGENTMAIL_API_KEY not set' };
  }

  const to = opts.to ?? process.env['AGENTMAIL_DEFAULT_TO'];
  if (!to) {
    return {
      ok: false,
      error: 'Recipient not specified. Set opts.to or AGENTMAIL_DEFAULT_TO.',
    };
  }

  const inboxId = resolveInboxId(opts.from);
  const html = opts.html ?? markdownToHtml(opts.markdown);

  try {
    const client = new AgentMailClient({ apiKey });
    const response = await client.inboxes.messages.send(inboxId, {
      to,
      subject: opts.subject,
      html,
      // Plain text fallback — strip basic markdown syntax
      text: opts.markdown,
    });

    return { ok: true, messageId: response.messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
