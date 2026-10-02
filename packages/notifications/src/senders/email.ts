/**
 * packages/notifications/src/senders/email.ts
 *
 * Sends notification emails via the existing packages/agentmail infrastructure.
 * Templates now return branded HTML alongside markdown. When html is available,
 * it is passed directly to agentmail to skip markdown-to-HTML conversion.
 */

import { sendAgentReport } from '@repo/agentmail';
import type { AgentName } from '@repo/agentmail';
import type { NotificationEvent } from '../types';
import { renderTaskCompleted } from '../templates/task-completed';
import { renderTaskBlocked } from '../templates/task-blocked';
import { renderReviewRequested } from '../templates/review-requested';
import { renderAgentStatus } from '../templates/agent-status';
import { wrapInEmailLayout } from '../templates/email-layout';

const VALID_AGENTS: AgentName[] = [
  'rick',
  'sage',
  'noir',
  'scan',
  'delv',
  'trek',
  'echo',
  'bond',
  'vita',
];

function resolveFromAgent(actorAgent?: string): AgentName {
  if (actorAgent && VALID_AGENTS.includes(actorAgent as AgentName)) {
    return actorAgent as AgentName;
  }
  return 'sage'; // SAGE is the default notification sender
}

/**
 * Send a notification email for the given event.
 *
 * @param toAddress - Recipient email address
 * @param event - The notification event
 */
export async function sendEmailNotification(
  toAddress: string,
  event: NotificationEvent,
): Promise<{ success: boolean; error?: string }> {
  try {
    const fromAgent = resolveFromAgent(event.actorAgent);
    let subject: string;
    let markdown: string;
    let html: string | undefined;

    switch (event.type) {
      case 'task.completed': {
        const rendered = renderTaskCompleted(event.payload);
        subject = rendered.subject;
        markdown = rendered.markdown;
        html = rendered.html;
        break;
      }
      case 'task.blocked': {
        const rendered = renderTaskBlocked(event.payload);
        subject = rendered.subject;
        markdown = rendered.markdown;
        html = rendered.html;
        break;
      }
      case 'review.requested':
      case 'review.completed': {
        const rendered = renderReviewRequested(event.payload, event.type);
        subject = rendered.subject;
        markdown = rendered.markdown;
        html = rendered.html;
        break;
      }
      case 'agent.status_changed': {
        const rendered = renderAgentStatus(event.payload);
        subject = rendered.subject;
        markdown = rendered.markdown;
        html = rendered.html;
        break;
      }
      default: {
        // Generic fallback for unknown event types — wrap in branded layout
        const title = (event.payload.title as string) || event.type;
        subject = `[Celune] ${title}`;
        markdown = `## ${title}\n\n${JSON.stringify(event.payload, null, 2)}`;
        html = wrapInEmailLayout(
          subject,
          `<h2>${title}</h2><pre>${JSON.stringify(event.payload, null, 2)}</pre>`,
        );
      }
    }

    const result = await sendAgentReport({
      from: fromAgent,
      to: toAddress,
      subject,
      markdown,
      html,
    });

    if (!result.ok) {
      return { success: false, error: result.error ?? 'Email send failed' };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Email send failed: ${message}` };
  }
}
