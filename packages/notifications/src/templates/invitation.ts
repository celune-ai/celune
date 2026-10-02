/**
 * Workspace Invitation email template.
 *
 * Payload shape:
 *   workspace_name: string
 *   inviter_name: string
 *   role: string             — e.g. 'member', 'admin', 'viewer'
 *   accept_url: string       — link to accept the invitation
 */
import { DEFAULT_APP_URL } from '../branding';
import { wrapInEmailLayout, emailCtaButton } from './email-layout';

export interface InvitationPayload {
  workspace_name: string;
  inviter_name: string;
  role: string;
  accept_url: string;
}

export function renderInvitation(payload: InvitationPayload): {
  subject: string;
  markdown: string;
  html: string;
} {
  const workspaceName = payload.workspace_name || 'a workspace';
  const inviterName = payload.inviter_name || 'A team member';
  const role = payload.role || 'member';
  const acceptUrl = payload.accept_url || DEFAULT_APP_URL;

  const subject = `You're invited to join ${workspaceName} on Celune`;

  const markdown = `
## You've been invited

**${inviterName}** has invited you to join **${workspaceName}** as a **${role}** on Celune.

Celune is an AI-powered workspace where agents and humans collaborate on projects, tasks, and code together.

[Accept Invitation](${acceptUrl})

---

_If you didn't expect this invitation, you can safely ignore this email._
`.trim();

  const bodyHtml = `
<h2 style="margin-top:0;">You've been invited</h2>
<p><strong>${escapeHtml(inviterName)}</strong> has invited you to join <strong>${escapeHtml(workspaceName)}</strong> as a <strong>${escapeHtml(role)}</strong> on Celune.</p>
<p>Celune is an AI-powered workspace where agents and humans collaborate on projects, tasks, and code together.</p>
<div style="text-align:center;margin:24px 0;">
  ${emailCtaButton('Accept Invitation', acceptUrl)}
</div>
<hr>
<p style="color:#737373;font-size:13px;">If you didn't expect this invitation, you can safely ignore this email.</p>
`.trim();

  const html = wrapInEmailLayout(subject, bodyHtml);

  return { subject, markdown, html };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
