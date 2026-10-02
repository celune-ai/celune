/**
 * packages/notifications
 *
 * Central notification dispatch service for the Celune platform.
 *
 * Usage:
 *   import { dispatchNotification } from '@repo/notifications';
 *
 *   await dispatchNotification({
 *     type: 'task.completed',
 *     workspaceId: 'xxx',
 *     actorAgent: 'rick',
 *     payload: { task_id: 'yyy', task_title: 'Build auth system', outcome: 'Done.' },
 *   });
 *
 * The call is non-blocking and best-effort — it never throws.
 */

export { dispatchNotification } from './dispatch';
export { sendSlackNotification } from './senders/slack';
export { sendEmailNotification } from './senders/email';
export { renderWeeklyDigest } from './templates/weekly-digest';
export { renderTaskCompleted } from './templates/task-completed';
export { renderTaskBlocked } from './templates/task-blocked';
export { renderReviewRequested } from './templates/review-requested';
export { renderAgentStatus } from './templates/agent-status';
export { wrapInEmailLayout, emailCtaButton } from './templates/email-layout';
export { renderInvitation } from './templates/invitation';
export type { InvitationPayload } from './templates/invitation';
export type {
  NotificationEvent,
  NotificationChannel,
  NotificationPreference,
  SlackConnection,
  NotificationFrequency,
  DispatchResult,
  EventType,
} from './types';
export { EVENT_TYPES, NOTIFICATION_CHANNELS, ACTIVE_CHANNELS, COMING_SOON_CHANNELS } from './types';
