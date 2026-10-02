/**
 * Task Blocked email template — action required.
 *
 * Payload shape:
 *   task_title: string
 *   task_id: string
 *   agent_name: string
 *   blocker_reason: string  — why the agent is blocked
 *   dashboard_url: string
 *   workspace_name: string
 */
import { DEFAULT_APP_URL } from '../branding';
import { wrapInEmailLayout, emailCtaButton } from './email-layout';

export function renderTaskBlocked(payload: Record<string, unknown>): {
  subject: string;
  markdown: string;
  html: string;
} {
  const agentName = (payload.agent_name as string) || 'Agent';
  const taskTitle = (payload.task_title as string) || 'Task';
  const blockerReason = (payload.blocker_reason as string) || 'No reason specified.';
  const dashboardUrl = (payload.dashboard_url as string) || DEFAULT_APP_URL;
  const workspaceName = (payload.workspace_name as string) || 'your workspace';

  const subject = `Action Required: ${taskTitle} is blocked`;

  const markdown = `
## Action Required

**${agentName}** is blocked on a task in ${workspaceName} and needs your input.

### ${taskTitle}

**Why it's blocked:**

${blockerReason}

---

[Review Task in Dashboard](${dashboardUrl})

---

_Blocked tasks need human input before the agent can continue. Please review and unblock to keep the project moving._

_[Manage notification preferences](${dashboardUrl}/settings?tab=notifications)_
`.trim();

  const bodyHtml = `
<h2>Action Required</h2>
<p><strong>${escapeHtml(agentName)}</strong> is blocked on a task in ${escapeHtml(workspaceName)} and needs your input.</p>
<h3>${escapeHtml(taskTitle)}</h3>
<p><strong>Why it's blocked:</strong></p>
<p>${escapeHtml(blockerReason)}</p>
<hr>
${emailCtaButton('Review Task in Dashboard', dashboardUrl)}
<p style="color:#737373;font-size:13px;margin-top:16px;">Blocked tasks need human input before the agent can continue. Please review and unblock to keep the project moving.</p>
`.trim();

  const html = wrapInEmailLayout(subject, bodyHtml);

  return { subject, markdown, html };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
