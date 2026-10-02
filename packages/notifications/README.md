# @repo/notifications

Multi-channel notification dispatch system for the Celune platform. Sends notifications via Slack and email (AgentMail), with templated content for various event types.

## Exports

| Export                                | File                     | Purpose                              |
| ------------------------------------- | ------------------------ | ------------------------------------ |
| `@repo/notifications`                 | `src/index.ts`           | Main dispatch entry point            |
| `@repo/notifications/decrypt-webhook` | `src/decrypt-webhook.ts` | Decrypt AES-256-GCM webhook payloads |
| `@repo/notifications/senders/slack`   | `src/senders/slack.ts`   | Slack message sender                 |
| `@repo/notifications/types`           | `src/types.ts`           | Notification type definitions        |

## Key Files

| File                                | Purpose                                    |
| ----------------------------------- | ------------------------------------------ |
| `src/dispatch.ts`                   | Route notifications to correct sender      |
| `src/senders/slack.ts`              | Send Slack messages via webhook/API        |
| `src/senders/email.ts`              | Send emails via AgentMail                  |
| `src/branding.ts`                   | Brand colors, logos, and styling constants |
| `src/templates/weekly-digest.ts`    | Weekly activity digest template            |
| `src/templates/invitation.ts`       | Workspace invitation template              |
| `src/templates/review-requested.ts` | PR review request template                 |
| `src/templates/agent-status.ts`     | Agent status change template               |
| `src/templates/task-blocked.ts`     | Task blocked notification template         |
| `src/templates/task-completed.ts`   | Task completed notification template       |
| `src/templates/email-layout.ts`     | Shared HTML email layout wrapper           |

## Dependencies

- `@repo/agentmail` — Email delivery via AgentMail
- `@repo/db` — Database access for notification preferences

## Usage

```ts
import { dispatch } from '@repo/notifications';

await dispatch({
  type: 'task-completed',
  workspaceId: '...',
  payload: { taskId: '...', title: '...' },
});
```
