/**
 * Task Completed email template.
 *
 * Payload shape:
 *   task_title: string
 *   task_id: string
 *   agent_name: string      — human-readable e.g. 'RICK'
 *   outcome: string         — agent's completion summary
 *   dashboard_url: string   — deep link to the task
 *   workspace_name: string
 */
import { DEFAULT_APP_URL } from '../branding';
import { wrapInEmailLayout, emailCtaButton } from './email-layout';

export function renderTaskCompleted(payload: Record<string, unknown>): {
  subject: string;
  markdown: string;
  html: string;
} {
  const agentName = (payload.agent_name as string) || 'Agent';
  const taskTitle = (payload.task_title as string) || 'Task';
  const outcome = (payload.outcome as string) || '';
  const dashboardUrl = (payload.dashboard_url as string) || DEFAULT_APP_URL;
  const workspaceName = (payload.workspace_name as string) || 'your workspace';

  const subject = `[${agentName}] Task Complete: ${taskTitle}`;

  const markdown = `
## Task Completed

**${agentName}** has finished a task in ${workspaceName}.

### ${taskTitle}

${outcome ? `**Outcome:**\n\n${outcome}` : '_No outcome summary provided._'}

---

[View Task in Dashboard](${dashboardUrl})

---

_You're receiving this because you have task completion notifications enabled. [Manage preferences](${dashboardUrl}/settings?tab=notifications)_
`.trim();

  const bodyHtml = `
<h2>Task Completed</h2>
<p><strong>${escapeHtml(agentName)}</strong> has finished a task in ${escapeHtml(workspaceName)}.</p>
<h3>${escapeHtml(taskTitle)}</h3>
${outcome ? `<p><strong>Outcome:</strong></p><p>${escapeHtml(outcome)}</p>` : '<p><em>No outcome summary provided.</em></p>'}
<hr>
${emailCtaButton('View Task in Dashboard', dashboardUrl)}
`.trim();

  const html = wrapInEmailLayout(subject, bodyHtml);

  return { subject, markdown, html };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
