/**
 * Weekly Digest email template.
 *
 * Payload shape:
 *   week_of: string         — e.g. '2026-03-02'
 *   workspace_name: string
 *   dashboard_url: string
 *   events_by_agent: Array<{
 *     agent: string
 *     events: Array<{ type: string; title: string; completed_at: string }>
 *   }>
 *   totals: {
 *     tasks_completed: number
 *     tasks_blocked: number
 *     reviews_completed: number
 *     deploys: number
 *   }
 */

interface DigestEvent {
  type: string;
  title: string;
  completed_at: string;
}

interface AgentGroup {
  agent: string;
  events: DigestEvent[];
}

interface DigestTotals {
  tasks_completed?: number;
  tasks_blocked?: number;
  reviews_completed?: number;
  deploys?: number;
}

import { DEFAULT_APP_URL } from '../branding';
import { wrapInEmailLayout, emailCtaButton } from './email-layout';

function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

function eventLabel(type: string): string {
  const labels: Record<string, string> = {
    'task.completed': 'Completed',
    'task.blocked': 'Blocked',
    'task.assigned': 'Assigned',
    'review.requested': 'Review requested',
    'review.completed': 'Review complete',
    'deploy.triggered': 'Deploy triggered',
    'deploy.completed': 'Deploy complete',
  };
  return labels[type] ?? type;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderWeeklyDigest(payload: Record<string, unknown>): {
  subject: string;
  markdown: string;
  html: string;
} {
  const weekOf = (payload.week_of as string) || new Date().toISOString().split('T')[0];
  const workspaceName = (payload.workspace_name as string) || 'your workspace';
  const dashboardUrl = (payload.dashboard_url as string) || DEFAULT_APP_URL;
  const eventsByAgent = (payload.events_by_agent as AgentGroup[]) || [];
  const totals = (payload.totals as DigestTotals) || {};

  const subject = `Celune Weekly Digest — week of ${formatDate(weekOf!)}`;

  // Markdown version
  const agentSections = eventsByAgent
    .filter((group) => group.events.length > 0)
    .map((group) => {
      const agentName = group.agent.toUpperCase();
      const eventLines = group.events
        .map((e) => `- **${eventLabel(e.type)}**: ${e.title} _(${formatDate(e.completed_at)})_`)
        .join('\n');
      return `### ${agentName}\n\n${eventLines}`;
    })
    .join('\n\n');

  const totalsSection = [
    totals.tasks_completed !== undefined
      ? `- Tasks completed: **${totals.tasks_completed}**`
      : null,
    totals.tasks_blocked !== undefined ? `- Tasks blocked: **${totals.tasks_blocked}**` : null,
    totals.reviews_completed !== undefined
      ? `- Code reviews: **${totals.reviews_completed}**`
      : null,
    totals.deploys !== undefined ? `- Deployments: **${totals.deploys}**` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const markdown = `
# Celune Weekly Digest

**Workspace:** ${workspaceName} — Week of ${formatDate(weekOf!)}

---

## This Week's Activity

${agentSections || '_No agent activity recorded this week._'}

---

## Totals

${totalsSection || '_No data._'}

---

[Open Celune](${dashboardUrl})

---

_Sent weekly every Sunday. [Manage digest preferences](${dashboardUrl}/settings?tab=notifications)_
`.trim();

  // HTML version
  const agentSectionsHtml = eventsByAgent
    .filter((group) => group.events.length > 0)
    .map((group) => {
      const agentName = escapeHtml(group.agent.toUpperCase());
      const eventItems = group.events
        .map(
          (e) =>
            `<li><strong>${escapeHtml(eventLabel(e.type))}</strong>: ${escapeHtml(e.title)} <span style="color:#737373;">(${escapeHtml(formatDate(e.completed_at))})</span></li>`,
        )
        .join('\n');
      return `<h3>${agentName}</h3>\n<ul>${eventItems}</ul>`;
    })
    .join('\n');

  const totalItems = [
    totals.tasks_completed !== undefined
      ? `<li>Tasks completed: <strong>${totals.tasks_completed}</strong></li>`
      : null,
    totals.tasks_blocked !== undefined
      ? `<li>Tasks blocked: <strong>${totals.tasks_blocked}</strong></li>`
      : null,
    totals.reviews_completed !== undefined
      ? `<li>Code reviews: <strong>${totals.reviews_completed}</strong></li>`
      : null,
    totals.deploys !== undefined
      ? `<li>Deployments: <strong>${totals.deploys}</strong></li>`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  const bodyHtml = `
<h1>Celune Weekly Digest</h1>
<p><strong>Workspace:</strong> ${escapeHtml(workspaceName)} &mdash; Week of ${escapeHtml(formatDate(weekOf!))}</p>
<hr>
<h2>This Week's Activity</h2>
${agentSectionsHtml || '<p><em>No agent activity recorded this week.</em></p>'}
<hr>
<h2>Totals</h2>
${totalItems ? `<ul>${totalItems}</ul>` : '<p><em>No data.</em></p>'}
<hr>
${emailCtaButton('Open Celune', dashboardUrl)}
`.trim();

  const html = wrapInEmailLayout(subject, bodyHtml);

  return { subject, markdown, html };
}
