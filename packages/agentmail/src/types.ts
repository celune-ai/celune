/** Known agent names that map to AgentMail inboxes. */
export type AgentName =
  'rick' | 'sage' | 'noir' | 'scan' | 'delv' | 'trek' | 'echo' | 'bond' | 'vita';

export interface SendReportOptions {
  /** Agent sending the email — maps to their AgentMail inbox. */
  from: AgentName;
  /** Recipient email address. Defaults to AGENTMAIL_DEFAULT_TO env var. */
  to?: string;
  /** Email subject line. */
  subject: string;
  /** Email body as Markdown — converted to HTML automatically. */
  markdown: string;
  /** Pre-rendered HTML body. When provided, skips markdown-to-HTML conversion. */
  html?: string;
}

export interface SendReportResult {
  ok: boolean;
  /** AgentMail message ID if successful. */
  messageId?: string;
  error?: string;
}
