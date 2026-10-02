# API Routes — Celune Platform

> Auto-generated route inventory. **252 route files** across `apps/platform/src/app/api/`.

---

## Access Codes (4 routes)

| Endpoint                     | Methods      | Description                              |
| ---------------------------- | ------------ | ---------------------------------------- |
| `/api/access-codes`          | GET, POST    | List and create access codes             |
| `/api/access-codes/[code]`   | DELETE       | Delete a specific access code            |
| `/api/access-codes/redeem`   | POST, DELETE | Redeem or revoke an access code          |
| `/api/access-codes/validate` | POST         | Validate an access code before redeeming |

## Activity (1 route)

| Endpoint        | Methods | Description                  |
| --------------- | ------- | ---------------------------- |
| `/api/activity` | GET     | Fetch workspace activity log |

## AgentMail (3 routes)

| Endpoint                 | Methods   | Description                         |
| ------------------------ | --------- | ----------------------------------- |
| `/api/agentmail/inboxes` | GET, POST | List and create agent email inboxes |
| `/api/agentmail/report`  | POST      | Generate agent email report         |
| `/api/agentmail/send`    | POST      | Send email from agent inbox         |

## Agents (22 routes)

| Endpoint                            | Methods          | Description                                 |
| ----------------------------------- | ---------------- | ------------------------------------------- |
| `/api/agents/[id]/audit`            | GET              | Get agent audit log                         |
| `/api/agents/[id]/budget`           | GET              | Get agent budget/usage limits               |
| `/api/agents/[id]/chat`             | POST             | Send chat message to agent (SSE streaming)  |
| `/api/agents/[id]/config`           | GET, PUT, DELETE | Get, update, or delete agent config         |
| `/api/agents/[id]/permissions`      | GET, PUT         | Get or update agent permissions             |
| `/api/agents/[id]/voice`            | GET, PUT         | Get or update agent voice settings          |
| `/api/agents/[id]/voice/clone`      | POST             | Clone a voice for the agent                 |
| `/api/agents/[id]/voice/dictionary` | GET, POST        | Manage agent voice pronunciation dictionary |
| `/api/agents/[id]/voice/preview`    | POST             | Preview agent voice with sample text        |
| `/api/agents/[id]/voice/tts`        | POST             | Text-to-speech generation                   |
| `/api/agents/[id]/voice/tts-stream` | POST             | Streaming text-to-speech                    |
| `/api/agents/activity`              | GET              | Get recent agent activity                   |
| `/api/agents/configs`               | GET              | List all agent configs for workspace        |
| `/api/agents/delegations`           | GET              | Get agent delegation chains                 |
| `/api/agents/health`                | GET              | Get agent health status                     |
| `/api/agents/heartbeat`             | GET              | Agent heartbeat check                       |
| `/api/agents/marketplace`           | GET              | Browse agent marketplace                    |
| `/api/agents/messages`              | GET              | Get agent message history                   |
| `/api/agents/seed`                  | POST             | Seed default agents for workspace           |
| `/api/agents/status`                | GET              | Get agent online/offline status             |
| `/api/agents/team-templates`        | GET              | Get agent team templates                    |
| `/api/agents/toggle`                | POST             | Toggle agent enabled/disabled               |

## Alerts (1 route)

| Endpoint             | Methods | Description                                   |
| -------------------- | ------- | --------------------------------------------- |
| `/api/alerts/sentry` | POST    | Receive Sentry alert webhooks (WARD auto-fix) |

## Analytics (18 routes)

| Endpoint                            | Methods | Description                      |
| ----------------------------------- | ------- | -------------------------------- |
| `/api/analytics/agents`             | GET     | Agent analytics overview         |
| `/api/analytics/agents/cache`       | GET     | Cached agent analytics data      |
| `/api/analytics/agents/health`      | GET     | Agent health metrics             |
| `/api/analytics/agents/utilization` | GET     | Agent utilization metrics        |
| `/api/analytics/completion-time`    | GET     | Task completion time analytics   |
| `/api/analytics/cost`               | GET     | Cost analytics overview          |
| `/api/analytics/cost/credits`       | GET     | Credit usage breakdown           |
| `/api/analytics/cost/elevenlabs`    | GET     | ElevenLabs (voice) cost tracking |
| `/api/analytics/cost/ingest`        | POST    | Ingest cost data                 |
| `/api/analytics/cost/limits`        | GET     | Cost limit settings              |
| `/api/analytics/cost/subscriptions` | GET     | Subscription cost data           |
| `/api/analytics/cost/summary`       | GET     | Cost summary rollup              |
| `/api/analytics/cost/trend`         | GET     | Cost trend over time             |
| `/api/analytics/dashboard`          | GET     | Dashboard analytics              |
| `/api/analytics/errors`             | GET     | Error analytics                  |
| `/api/analytics/overview`           | GET     | Overview analytics               |
| `/api/analytics/priorities`         | GET     | Priority distribution analytics  |
| `/api/analytics/usage`              | GET     | Usage analytics                  |
| `/api/analytics/usage/rollup`       | POST    | Usage rollup aggregation         |
| `/api/analytics/utilization`        | GET     | Resource utilization analytics   |
| `/api/analytics/velocity`           | GET     | Team velocity metrics            |
| `/api/analytics/deployments`        | GET     | Deployment analytics             |

## API Keys (2 routes)

| Endpoint             | Methods       | Description                 |
| -------------------- | ------------- | --------------------------- |
| `/api/api-keys`      | GET, POST     | List and create API keys    |
| `/api/api-keys/[id]` | PATCH, DELETE | Update or revoke an API key |

## Audit Log (1 route)

| Endpoint         | Methods | Description               |
| ---------------- | ------- | ------------------------- |
| `/api/audit-log` | GET     | Fetch workspace audit log |

## Auth (7 routes)

| Endpoint                  | Methods | Description                          |
| ------------------------- | ------- | ------------------------------------ |
| `/api/auth/cli-exchange`  | POST    | Exchange CLI setup token for session |
| `/api/auth/cli-setup`     | POST    | Generate CLI setup token             |
| `/api/auth/cli-token`     | POST    | Generate CLI authentication token    |
| `/api/auth/device/code`   | POST    | Generate device authorization code   |
| `/api/auth/device/token`  | POST    | Exchange device code for token       |
| `/api/auth/device/verify` | POST    | Verify device authorization code     |
| `/api/auth/signout`       | POST    | Sign out current session             |

## Billing (6 routes)

| Endpoint                    | Methods | Description                           |
| --------------------------- | ------- | ------------------------------------- |
| `/api/billing/checkout`     | POST    | Create Stripe checkout session        |
| `/api/billing/plans`        | GET     | List available billing plans          |
| `/api/billing/portal`       | POST    | Create Stripe customer portal session |
| `/api/billing/subscription` | GET     | Get current subscription details      |
| `/api/billing/usage`        | GET     | Get billing usage data                |
| `/api/billing/webhook`      | POST    | Stripe webhook handler                |

## Brain (16 routes)

| Endpoint                            | Methods            | Description                                                   |
| ----------------------------------- | ------------------ | ------------------------------------------------------------- |
| `/api/brain/apply-updates`          | POST               | Apply pending brain updates                                   |
| `/api/brain/daily-plans`            | GET, POST          | List and create daily plans                                   |
| `/api/brain/export`                 | GET                | Export workspace brain data (versioned JSON, gzip when large) |
| `/api/brain/extract-code`           | POST               | Extract code snippets from brain content                      |
| `/api/brain/generate-summary`       | POST               | Generate brain content summary                                |
| `/api/brain/health`                 | GET                | Brain system health check                                     |
| `/api/brain/import`                 | POST               | Import a brain export (mode=merge or overwrite)               |
| `/api/brain/knowledge-sources`      | GET, POST          | List and add knowledge sources                                |
| `/api/brain/knowledge-sources/[id]` | GET, PATCH, DELETE | Get, update, or delete a knowledge source                     |
| `/api/brain/manifest`               | GET                | Get brain manifest (skills, agents, hooks)                    |
| `/api/brain/merge-preview`          | POST               | Preview brain merge changes                                   |
| `/api/brain/merge-resolve`          | POST               | Resolve brain merge conflicts                                 |
| `/api/brain/settings`               | GET, PATCH         | Get or update brain settings                                  |
| `/api/brain/tier-change`            | POST               | Handle brain tier change                                      |
| `/api/brain/updates`                | GET                | Get pending brain updates                                     |
| `/api/brain/vault-publish`          | GET, POST          | Publish to vault                                              |
| `/api/brain/vault-sync`             | GET, POST, DELETE  | Sync vault content                                            |
| `/api/brain/version`                | GET, POST          | Get or create brain version                                   |

## Chat (1 route)

| Endpoint            | Methods | Description          |
| ------------------- | ------- | -------------------- |
| `/api/chat/support` | POST    | Support chat with AI |

## Cron (3 routes)

| Endpoint                  | Methods | Description                     |
| ------------------------- | ------- | ------------------------------- |
| `/api/cron/jobs`          | GET     | List scheduled cron jobs        |
| `/api/cron/run`           | POST    | Trigger a cron job run          |
| `/api/cron/weekly-digest` | POST    | Generate and send weekly digest |

## Discord (6 routes)

| Endpoint                         | Methods  | Description                                           |
| -------------------------------- | -------- | ----------------------------------------------------- |
| `/api/discord/channels`          | GET, PUT | List and update Discord channels                      |
| `/api/discord/gateway-events`    | POST     | Receive Discord gateway events                        |
| `/api/discord/install`           | GET      | Discord bot install redirect                          |
| `/api/discord/interactions`      | POST     | Discord interaction webhook (slash commands, buttons) |
| `/api/discord/oauth/callback`    | GET      | Discord OAuth callback handler                        |
| `/api/discord/register-commands` | POST     | Register Discord slash commands                       |

## Executions (4 routes)

| Endpoint                   | Methods     | Description                        |
| -------------------------- | ----------- | ---------------------------------- |
| `/api/executions`          | GET         | List skill executions              |
| `/api/executions/[id]`     | GET, DELETE | Get or cancel a specific execution |
| `/api/executions/[id]/run` | POST        | Run a skill execution              |
| `/api/executions/cancel`   | POST        | Cancel a running execution         |

## Flags (2 routes)

| Endpoint            | Methods | Description                       |
| ------------------- | ------- | --------------------------------- |
| `/api/flags`        | GET     | Get feature flags (authenticated) |
| `/api/flags/public` | GET     | Get public feature flags          |

## GitHub (16 routes)

| Endpoint                                     | Methods     | Description                           |
| -------------------------------------------- | ----------- | ------------------------------------- |
| `/api/github/branches`                       | GET         | List repository branches              |
| `/api/github/callback`                       | GET, POST   | GitHub OAuth callback                 |
| `/api/github/context`                        | GET         | Get GitHub context for workspace      |
| `/api/github/detect-installation`            | GET         | Detect GitHub App installation        |
| `/api/github/file-conflicts`                 | GET         | Check for file conflicts              |
| `/api/github/install`                        | GET, POST   | GitHub App installation flow          |
| `/api/github/installations`                  | GET, DELETE | List or remove GitHub installations   |
| `/api/github/installations/[installationId]` | GET, DELETE | Get or remove a specific installation |
| `/api/github/pr-review`                      | POST        | Trigger PR review                     |
| `/api/github/prs`                            | GET, POST   | List PRs or create review             |
| `/api/github/prs/[number]`                   | GET, PATCH  | Get or update a specific PR           |
| `/api/github/repos`                          | GET, POST   | List or connect repositories          |
| `/api/github/reviews`                        | POST        | Submit GitHub review                  |
| `/api/github/reviews/reply`                  | POST        | Reply to a review comment             |
| `/api/github/sync-installation`              | POST        | Sync GitHub installation data         |
| `/api/github/webhooks`                       | POST        | GitHub webhook handler                |

## Health (3 routes)

| Endpoint                      | Methods | Description                      |
| ----------------------------- | ------- | -------------------------------- |
| `/api/health`                 | GET     | Platform health check            |
| `/api/health/check-and-alert` | POST    | Health check with alert dispatch |
| `/api/health/mcps`            | GET     | MCP server health status         |

## Hooks (1 route)

| Endpoint            | Methods | Description                                 |
| ------------------- | ------- | ------------------------------------------- |
| `/api/hooks/notify` | POST    | Notify hook endpoint (IDE/CLI integrations) |

## Integrations (2 routes)

| Endpoint                           | Methods      | Description                          |
| ---------------------------------- | ------------ | ------------------------------------ |
| `/api/integrations/sentry/install` | POST, DELETE | Install or remove Sentry integration |
| `/api/integrations/status`         | GET          | Get integration connection statuses  |

## Invitations (3 routes)

| Endpoint                  | Methods     | Description                     |
| ------------------------- | ----------- | ------------------------------- |
| `/api/invitations`        | GET         | List pending invitations        |
| `/api/invitations/[id]`   | PUT, DELETE | Accept or decline an invitation |
| `/api/invitations/accept` | POST        | Accept an invitation by token   |

## Knowledge (7 routes)

> **Note:** Overlaps with `brain/knowledge-sources/` — this is the newer Nango-backed knowledge integration surface. Brain knowledge-sources are legacy brain-scoped; knowledge/ routes handle external OAuth sources (Google Drive, Notion, etc.).

| Endpoint                                  | Methods            | Description                               |
| ----------------------------------------- | ------------------ | ----------------------------------------- |
| `/api/knowledge/oauth/callback`           | GET                | Nango OAuth callback                      |
| `/api/knowledge/oauth/connect/[provider]` | GET                | Initiate OAuth connection for a provider  |
| `/api/knowledge/search`                   | POST               | Search across connected knowledge sources |
| `/api/knowledge/sources`                  | GET, POST          | List and connect knowledge sources        |
| `/api/knowledge/sources/[id]`             | GET, PATCH, DELETE | Get, update, or delete a knowledge source |
| `/api/knowledge/sources/[id]/sync`        | POST, PUT          | Trigger or update sync for a source       |
| `/api/knowledge/upload`                   | POST               | Upload a file as a knowledge source       |

## MCP (3 routes)

| Endpoint          | Methods           | Description             |
| ----------------- | ----------------- | ----------------------- |
| `/api/mcp`        | POST, GET, DELETE | MCP protocol handler    |
| `/api/mcp/health` | GET               | MCP server health check |
| `/api/mcp/stream` | GET               | MCP SSE stream          |

## Memory (11 routes)

| Endpoint                             | Methods            | Description                                     |
| ------------------------------------ | ------------------ | ----------------------------------------------- |
| `/api/memory/contradictions`         | GET                | Detect memory contradictions                    |
| `/api/memory/entries`                | GET, POST          | List and create memory entries                  |
| `/api/memory/entries/[id]`           | GET, PATCH, DELETE | Get, update, or delete a memory entry           |
| `/api/memory/entries/[id]/relations` | GET, POST, DELETE  | Manage memory entry relations (knowledge graph) |
| `/api/memory/graph`                  | GET                | Get memory knowledge graph                      |
| `/api/memory/heartbeat`              | POST               | Memory system heartbeat                         |
| `/api/memory/ingest`                 | POST               | Ingest content into memory                      |
| `/api/memory/limit`                  | GET                | Get memory storage limits                       |
| `/api/memory/search`                 | GET                | Full-text memory search                         |
| `/api/memory/semantic-search`        | GET                | Vector/semantic memory search                   |
| `/api/memory/stats`                  | GET                | Memory usage statistics                         |

## Notifications (7 routes)

| Endpoint                            | Methods     | Description                               |
| ----------------------------------- | ----------- | ----------------------------------------- |
| `/api/notifications/dispatch`       | POST        | Dispatch a notification                   |
| `/api/notifications/history`        | GET         | Get notification history                  |
| `/api/notifications/preferences`    | GET         | Get notification preferences              |
| `/api/notifications/slack/callback` | GET         | Slack notification OAuth callback         |
| `/api/notifications/slack/connect`  | GET, DELETE | Connect or disconnect Slack notifications |
| `/api/notifications/slack/status`   | GET, PATCH  | Get or update Slack notification status   |
| `/api/notifications/test`           | POST        | Send a test notification                  |

## Onboarding (7 routes)

| Endpoint                            | Methods   | Description                               |
| ----------------------------------- | --------- | ----------------------------------------- |
| `/api/onboarding/bootstrap`         | POST, GET | Bootstrap onboarding flow                 |
| `/api/onboarding/chat`              | POST      | Onboarding chat interaction               |
| `/api/onboarding/confirm-profile`   | POST      | Confirm user profile from onboarding      |
| `/api/onboarding/conversation`      | GET       | Get onboarding conversation history       |
| `/api/onboarding/exit`              | POST      | Exit onboarding flow                      |
| `/api/onboarding/generate`          | POST      | Generate onboarding content               |
| `/api/onboarding/generate-projects` | POST, GET | Generate starter projects from onboarding |

## Org (4 routes)

| Endpoint                      | Methods | Description               |
| ----------------------------- | ------- | ------------------------- |
| `/api/org/agents/shared`      | GET     | List shared org agents    |
| `/api/org/agents/shared/[id]` | DELETE  | Remove a shared org agent |
| `/api/org/permissions`        | GET     | Get org-level permissions |
| `/api/org/settings`           | GET     | Get org settings          |
| `/api/org/transfer-ownership` | POST    | Transfer org ownership    |

## Portfolio / Credential Vault (3 routes)

| Endpoint                        | Methods       | Description                    |
| ------------------------------- | ------------- | ------------------------------ |
| `/api/portfolio/passwords`      | GET, POST     | List and store credentials     |
| `/api/portfolio/passwords/[id]` | PATCH, DELETE | Update or delete a credential  |
| `/api/portfolio/verify`         | POST          | Verify credential vault access |

## Project Groups (3 routes)

| Endpoint                      | Methods          | Description                            |
| ----------------------------- | ---------------- | -------------------------------------- |
| `/api/project-groups`         | GET              | List project groups                    |
| `/api/project-groups/[id]`    | GET, PUT, DELETE | Get, update, or delete a project group |
| `/api/project-groups/reorder` | POST             | Reorder project groups                 |

## Projects (5 routes)

| Endpoint                   | Methods          | Description                      |
| -------------------------- | ---------------- | -------------------------------- |
| `/api/projects`            | GET              | List workspace projects          |
| `/api/projects/[id]`       | GET, PUT, DELETE | Get, update, or delete a project |
| `/api/projects/[id]/build` | POST, DELETE     | Start or cancel a project build  |
| `/api/projects/progress`   | GET              | Get project progress metrics     |
| `/api/projects/reorder`    | POST             | Reorder projects                 |

## Provider Keys (3 routes)

| Endpoint                    | Methods       | Description                             |
| --------------------------- | ------------- | --------------------------------------- |
| `/api/provider-keys`        | GET, POST     | List and store provider API keys (BYOK) |
| `/api/provider-keys/[id]`   | PATCH, DELETE | Update or delete a provider key         |
| `/api/provider-keys/status` | GET           | Check provider key validation status    |

## Readiness (1 route)

| Endpoint         | Methods | Description                      |
| ---------------- | ------- | -------------------------------- |
| `/api/readiness` | GET     | Kubernetes-style readiness probe |

## Roles (1 route)

| Endpoint     | Methods | Description                    |
| ------------ | ------- | ------------------------------ |
| `/api/roles` | GET     | List available workspace roles |

## Settings (1 route)

| Endpoint                      | Methods    | Description                          |
| ----------------------------- | ---------- | ------------------------------------ |
| `/api/settings/github-review` | GET, PATCH | Get or update GitHub review settings |

## Skill Packs (2 routes)

| Endpoint                          | Methods      | Description                       |
| --------------------------------- | ------------ | --------------------------------- |
| `/api/skill-packs`                | GET          | List available skill packs        |
| `/api/skill-packs/[slug]/install` | POST, DELETE | Install or uninstall a skill pack |

## Skills (4 routes)

| Endpoint               | Methods            | Description                    |
| ---------------------- | ------------------ | ------------------------------ |
| `/api/skills`          | GET, POST          | List and create skills         |
| `/api/skills/[id]`     | GET, PATCH, DELETE | Get, update, or delete a skill |
| `/api/skills/load`     | GET                | Load skills for execution      |
| `/api/skills/validate` | POST               | Validate skill definition      |

## Slack (5 routes)

| Endpoint                  | Methods | Description                         |
| ------------------------- | ------- | ----------------------------------- |
| `/api/slack/celune`       | POST    | Celune Slack bot handler            |
| `/api/slack/commands`     | POST    | Slack slash command handler         |
| `/api/slack/digest`       | POST    | Post digest to Slack                |
| `/api/slack/events`       | POST    | Slack Events API handler            |
| `/api/slack/interactions` | POST    | Slack interactive component handler |

## Support (6 routes)

| Endpoint                            | Methods | Description                      |
| ----------------------------------- | ------- | -------------------------------- |
| `/api/support/chat`                 | POST    | AI support chat                  |
| `/api/support/contact`              | POST    | Submit contact form              |
| `/api/support/conversations`        | GET     | List support conversations       |
| `/api/support/feedback`             | GET     | List user feedback               |
| `/api/support/tickets`              | GET     | List support tickets             |
| `/api/support/triage`               | GET     | Get triage queue                 |
| `/api/support/triage/[id]/messages` | GET     | Get triage conversation messages |

## Tasks (13 routes)

| Endpoint                                     | Methods          | Description                      |
| -------------------------------------------- | ---------------- | -------------------------------- |
| `/api/tasks`                                 | GET              | List workspace tasks             |
| `/api/tasks/[id]`                            | GET, PUT, DELETE | Get, update, or delete a task    |
| `/api/tasks/[id]/attachments`                | GET, POST        | List and upload task attachments |
| `/api/tasks/[id]/attachments/[attachmentId]` | DELETE           | Delete a task attachment         |
| `/api/tasks/[id]/children`                   | GET              | Get child/sub-tasks              |
| `/api/tasks/[id]/comments`                   | GET, POST        | List and add task comments       |
| `/api/tasks/[id]/context`                    | GET              | Get task context                 |
| `/api/tasks/[id]/dependencies`               | GET              | Get task dependencies            |
| `/api/tasks/[id]/initiate`                   | POST             | Initiate task execution          |
| `/api/tasks/[id]/spawned`                    | GET              | Get spawned sub-tasks            |
| `/api/tasks/[id]/usage`                      | GET              | Get task resource usage          |
| `/api/tasks/generate`                        | POST             | AI-generate task details         |
| `/api/tasks/reorder`                         | POST             | Reorder tasks                    |

## Trial Status (1 route)

| Endpoint            | Methods | Description             |
| ------------------- | ------- | ----------------------- |
| `/api/trial-status` | GET     | Get trial period status |

## User (7 routes)

| Endpoint                   | Methods           | Description                      |
| -------------------------- | ----------------- | -------------------------------- |
| `/api/user/delete-account` | DELETE            | Delete user account and all data |
| `/api/user/invite`         | POST              | Send user invitation             |
| `/api/user/level`          | GET               | Get user experience level        |
| `/api/user/permissions`    | GET               | Get current user permissions     |
| `/api/user/profile`        | GET               | Get current user profile         |
| `/api/user/role`           | GET               | Get current user role            |
| `/api/user/sessions`       | GET, POST, DELETE | List, create, or revoke sessions |

## Users (Admin) (4 routes)

| Endpoint                 | Methods | Description            |
| ------------------------ | ------- | ---------------------- |
| `/api/users`             | GET     | List workspace users   |
| `/api/users/[id]`        | DELETE  | Delete a user          |
| `/api/users/[id]/role`   | PUT     | Update user role       |
| `/api/users/[id]/status` | PUT     | Update user status     |
| `/api/users/platform`    | GET     | Get platform user info |

## Voice (3 routes)

| Endpoint                | Methods | Description              |
| ----------------------- | ------- | ------------------------ |
| `/api/voice/parse`      | POST    | Parse voice input        |
| `/api/voice/preview`    | POST    | Preview voice output     |
| `/api/voice/transcribe` | POST    | Transcribe audio to text |

## Waitlist (1 route)

| Endpoint        | Methods | Description          |
| --------------- | ------- | -------------------- |
| `/api/waitlist` | GET     | Get waitlist entries |

## Webhooks (5 routes)

| Endpoint                         | Methods       | Description                         |
| -------------------------------- | ------------- | ----------------------------------- |
| `/api/webhooks/agentmail`        | POST          | AgentMail webhook handler           |
| `/api/webhooks/endpoints`        | GET           | List webhook endpoints              |
| `/api/webhooks/endpoints/[id]`   | PATCH, DELETE | Update or delete a webhook endpoint |
| `/api/webhooks/retry`            | POST          | Retry a failed webhook delivery     |
| `/api/webhooks/sentry`           | POST          | Sentry webhook handler              |
| `/api/webhooks/sentry/heartbeat` | POST          | Sentry heartbeat webhook            |

## Workspace Members (2 routes)

| Endpoint                      | Methods       | Description                         |
| ----------------------------- | ------------- | ----------------------------------- |
| `/api/workspace-members`      | GET           | List workspace members              |
| `/api/workspace-members/[id]` | PATCH, DELETE | Update or remove a workspace member |

## Workspace (7 routes)

| Endpoint                         | Methods | Description                                                                                          |
| -------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `/api/workspace-state`           | GET     | Get workspace state                                                                                  |
| `/api/workspace/export`          | GET     | Export the whole workspace (celune-workspace v1 JSON, or zip with README, env template, attachments) |
| `/api/workspace/getting-started` | GET     | Get getting-started checklist                                                                        |
| `/api/workspace/import`          | POST    | Import a workspace export (JSON, gzip, or zip; mode=merge or overwrite)                              |
| `/api/workspace/migration`       | GET     | Edition, Cloud target, and the Gate feature diff for a move                                          |
| `/api/workspace/migration/cloud` | POST    | Community edition: export and upload to Cloud with a pasted API key                                  |
| `/api/workspace/setup-status`    | GET     | Get workspace setup status                                                                           |

## Workspaces (7 routes)

| Endpoint                                      | Methods          | Description                           |
| --------------------------------------------- | ---------------- | ------------------------------------- |
| `/api/workspaces`                             | GET              | List user workspaces                  |
| `/api/workspaces/[id]`                        | GET, PUT, DELETE | Get, update, or delete a workspace    |
| `/api/workspaces/[id]/invitations`            | GET, POST        | List and create workspace invitations |
| `/api/workspaces/[id]/invitations/[inviteId]` | DELETE           | Revoke a workspace invitation         |
| `/api/workspaces/plan`                        | GET              | Get workspace plan details            |
| `/api/workspaces/usage`                       | GET              | Get workspace usage data              |
| `/api/workspaces/usage-status`                | GET              | Get workspace usage status            |

---

## Duplicate API Surface

> **`knowledge/` vs `brain/knowledge-sources/`** — Two overlapping surfaces exist for knowledge source management:
>
> - `brain/knowledge-sources/` (legacy) — Brain-scoped knowledge sources, tightly coupled to the brain manifest system
> - `knowledge/` (newer) — Nango-backed external OAuth sources (Google Drive, Notion, Confluence, etc.) with upload support
>
> Both support CRUD on sources and have similar shapes. Consider consolidating once the Nango migration is complete.

---

_Last updated: 2026-03-29 | 250 route files | 36 API sections_
