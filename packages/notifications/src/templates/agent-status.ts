/**
 * Agent Status Change email template.
 *
 * Payload shape:
 *   agent_name: string      — e.g. 'RICK'
 *   agent_id: string
 *   old_status: string
 *   new_status: string
 *   dashboard_url: string
 *   workspace_name: string
 */
import { DEFAULT_APP_URL } from '../branding';
import { wrapInEmailLayout, emailCtaButton } from './email-layout';

export function renderAgentStatus(payload: Record<string, unknown>): {
  subject: string;
  markdown: string;
  html: string;
} {
  const agentName = (payload.agent_name as string) || 'Agent';
  const newStatus = (payload.new_status as string) || 'unknown';
  const oldStatus = (payload.old_status as string) || '';
  const dashboardUrl = (payload.dashboard_url as string) || DEFAULT_APP_URL;
  const workspaceName = (payload.workspace_name as string) || 'your workspace';

  const subject = `${agentName} is now ${newStatus}`;

  const statusLine = oldStatus
    ? `**${agentName}** transitioned from **${oldStatus}** → **${newStatus}** in ${workspaceName}.`
    : `**${agentName}** is now **${newStatus}** in ${workspaceName}.`;

  const markdown = `
## Agent Status Change

${statusLine}

---

[View Agent in Dashboard](${dashboardUrl})

---

_[Manage notification preferences](${dashboardUrl}/settings?tab=notifications)_
`.trim();

  const statusHtml = oldStatus
    ? `<strong>${escapeHtml(agentName)}</strong> transitioned from <strong>${escapeHtml(oldStatus)}</strong> &rarr; <strong>${escapeHtml(newStatus)}</strong> in ${escapeHtml(workspaceName)}.`
    : `<strong>${escapeHtml(agentName)}</strong> is now <strong>${escapeHtml(newStatus)}</strong> in ${escapeHtml(workspaceName)}.`;

  const bodyHtml = `
<h2>Agent Status Change</h2>
<p>${statusHtml}</p>
<hr>
${emailCtaButton('View Agent in Dashboard', dashboardUrl)}
`.trim();

  const html = wrapInEmailLayout(subject, bodyHtml);

  return { subject, markdown, html };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
