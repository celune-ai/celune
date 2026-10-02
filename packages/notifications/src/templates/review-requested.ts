/**
 * Code Review templates — review.requested and review.completed.
 *
 * Payload shape:
 *   task_title: string
 *   task_id: string
 *   reviewer: string        — typically 'SCAN'
 *   result: 'pass' | 'fail' | null  — only for review.completed
 *   summary: string         — review summary or description
 *   dashboard_url: string
 *   workspace_name: string
 */
import { DEFAULT_APP_URL } from '../branding';
import { wrapInEmailLayout, emailCtaButton } from './email-layout';

export function renderReviewRequested(
  payload: Record<string, unknown>,
  eventType: string,
): {
  subject: string;
  markdown: string;
  html: string;
} {
  const taskTitle = (payload.task_title as string) || 'Task';
  const reviewer = (payload.reviewer as string) || 'SCAN';
  const summary = (payload.summary as string) || '';
  const dashboardUrl = (payload.dashboard_url as string) || DEFAULT_APP_URL;
  const workspaceName = (payload.workspace_name as string) || 'your workspace';

  if (eventType === 'review.completed') {
    const result = (payload.result as string) || 'unknown';
    const resultEmoji = result === 'pass' ? 'PASSED' : result === 'fail' ? 'FAILED' : 'COMPLETE';
    const subject = `Code Review ${resultEmoji}: ${taskTitle}`;

    const markdown = `
## Code Review ${resultEmoji}

**${reviewer}** has completed a code review in ${workspaceName}.

### ${taskTitle}

**Result:** ${result.toUpperCase()}

${summary ? `**Review notes:**\n\n${summary}` : ''}

---

[View Review in Dashboard](${dashboardUrl})

---

_[Manage notification preferences](${dashboardUrl}/settings?tab=notifications)_
`.trim();

    const resultColor = result === 'pass' ? '#5BC586' : result === 'fail' ? '#ef4444' : '#a3a3a3';
    const bodyHtml = `
<h2>Code Review ${escapeHtml(resultEmoji)}</h2>
<p><strong>${escapeHtml(reviewer)}</strong> has completed a code review in ${escapeHtml(workspaceName)}.</p>
<h3>${escapeHtml(taskTitle)}</h3>
<p><strong>Result:</strong> <span style="color:${resultColor};font-weight:600;">${escapeHtml(result.toUpperCase())}</span></p>
${summary ? `<p><strong>Review notes:</strong></p><p>${escapeHtml(summary)}</p>` : ''}
<hr>
${emailCtaButton('View Review in Dashboard', dashboardUrl)}
`.trim();

    const html = wrapInEmailLayout(subject, bodyHtml);
    return { subject, markdown, html };
  }

  // review.requested
  const subject = `Code Review Ready: ${taskTitle}`;

  const markdown = `
## Code Review Requested

**${reviewer}** is ready to review code for a task in ${workspaceName}.

### ${taskTitle}

${summary ? summary : '_Review request submitted. SCAN will begin the review shortly._'}

---

[View Task in Dashboard](${dashboardUrl})

---

_[Manage notification preferences](${dashboardUrl}/settings?tab=notifications)_
`.trim();

  const bodyHtml = `
<h2>Code Review Requested</h2>
<p><strong>${escapeHtml(reviewer)}</strong> is ready to review code for a task in ${escapeHtml(workspaceName)}.</p>
<h3>${escapeHtml(taskTitle)}</h3>
${summary ? `<p>${escapeHtml(summary)}</p>` : '<p><em>Review request submitted. SCAN will begin the review shortly.</em></p>'}
<hr>
${emailCtaButton('View Task in Dashboard', dashboardUrl)}
`.trim();

  const html = wrapInEmailLayout(subject, bodyHtml);
  return { subject, markdown, html };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
