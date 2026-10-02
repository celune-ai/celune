# API Routes Reference

Complete reference for all API routes in the Celune platform app (`apps/platform/src/app/api/`).

**Auth types:**

- **Authenticated** — requires Supabase session cookie or Bearer token (checked via `getAuthUserId`, `requirePermission`, `requireWorkspaceMembership`, `withApiSecurity`, or `extractWorkspaceScope`)
- **Signature-verified** — uses cryptographic signature (Ed25519, HMAC-SHA256) instead of session auth
- **CRON_SECRET** — protected by `Authorization: Bearer $CRON_SECRET` header (Vercel Cron)
- **Service key** — protected by `Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY`
- **API key** — uses `authenticateApiKey` for programmatic access (MCP, CLI)
- **Public** — no authentication required (redirect, webhook callback, or static data)

---

## Access Codes

| Method | Path                         | Auth          | Description                         |
| ------ | ---------------------------- | ------------- | ----------------------------------- |
| GET    | `/api/access-codes`          | Authenticated | List access codes                   |
| POST   | `/api/access-codes`          | Authenticated | Create access code                  |
| DELETE | `/api/access-codes/[code]`   | Authenticated | Delete access code                  |
| DELETE | `/api/access-codes/redeem`   | Authenticated | Revoke a redeemed code              |
| POST   | `/api/access-codes/redeem`   | Authenticated | Redeem an access code               |
| POST   | `/api/access-codes/validate` | Public        | Validate access code (rate-limited) |

## Activity

| Method | Path            | Auth          | Description               |
| ------ | --------------- | ------------- | ------------------------- |
| GET    | `/api/activity` | Authenticated | List activity log entries |
| PATCH  | `/api/activity` | Authenticated | Update activity entry     |
| POST   | `/api/activity` | Authenticated | Create activity log entry |

## AgentMail

| Method | Path                     | Auth          | Description                 |
| ------ | ------------------------ | ------------- | --------------------------- |
| GET    | `/api/agentmail/inboxes` | Authenticated | List agent email inboxes    |
| POST   | `/api/agentmail/inboxes` | Authenticated | Create agent email inbox    |
| POST   | `/api/agentmail/report`  | Authenticated | Generate email report       |
| POST   | `/api/agentmail/send`    | Authenticated | Send email from agent inbox |

## Agents

| Method | Path                                | Auth          | Description                     |
| ------ | ----------------------------------- | ------------- | ------------------------------- |
| GET    | `/api/agents/[id]/audit`            | Authenticated | Agent audit trail               |
| GET    | `/api/agents/[id]/budget`           | Authenticated | Agent budget usage              |
| POST   | `/api/agents/[id]/chat`             | Authenticated | Chat with agent (SSE streaming) |
| DELETE | `/api/agents/[id]/config`           | Authenticated | Delete agent config             |
| GET    | `/api/agents/[id]/config`           | Authenticated | Get agent config                |
| PUT    | `/api/agents/[id]/config`           | Authenticated | Update agent config             |
| GET    | `/api/agents/[id]/permissions`      | Authenticated | Get agent permissions           |
| PUT    | `/api/agents/[id]/permissions`      | Authenticated | Update agent permissions        |
| POST   | `/api/agents/[id]/voice/clone`      | Authenticated | Clone a voice for agent         |
| GET    | `/api/agents/[id]/voice/dictionary` | Authenticated | Get pronunciation dictionary    |
| POST   | `/api/agents/[id]/voice/dictionary` | Authenticated | Add pronunciation entry         |
| POST   | `/api/agents/[id]/voice/preview`    | Authenticated | Preview voice settings          |
| GET    | `/api/agents/[id]/voice`            | Public        | Get agent voice config          |
| PUT    | `/api/agents/[id]/voice`            | Public        | Update agent voice config       |
| POST   | `/api/agents/[id]/voice/tts-stream` | Authenticated | Text-to-speech streaming        |
| POST   | `/api/agents/[id]/voice/tts`        | Authenticated | Text-to-speech                  |
| GET    | `/api/agents/activity`              | Authenticated | Agent activity feed             |
| GET    | `/api/agents/configs`               | Authenticated | List all agent configs          |
| POST   | `/api/agents/configs`               | Authenticated | Create agent config             |
| GET    | `/api/agents/delegations`           | Authenticated | List agent delegations          |
| GET    | `/api/agents/health`                | Public        | Agent health check              |
| POST   | `/api/agents/heartbeat`             | Authenticated | Agent heartbeat ping            |
| GET    | `/api/agents/marketplace`           | Authenticated | Browse agent marketplace        |
| POST   | `/api/agents/marketplace`           | Authenticated | Publish to marketplace          |
| GET    | `/api/agents/messages`              | Authenticated | List agent messages             |
| POST   | `/api/agents/seed`                  | Authenticated | Seed default agent configs      |
| GET    | `/api/agents/status`                | Public        | Agent online status             |
| GET    | `/api/agents/team-templates`        | Authenticated | List team templates             |
| POST   | `/api/agents/team-templates`        | Authenticated | Create team template            |
| POST   | `/api/agents/toggle`                | Authenticated | Toggle agent enabled/disabled   |

## Alerts

| Method | Path                 | Auth          | Description        |
| ------ | -------------------- | ------------- | ------------------ |
| GET    | `/api/alerts/sentry` | Authenticated | List Sentry alerts |

## Analytics

| Method | Path                                | Auth          | Description                |
| ------ | ----------------------------------- | ------------- | -------------------------- |
| GET    | `/api/analytics/agents/cache`       | Authenticated | Agent analytics cache      |
| GET    | `/api/analytics/agents/health`      | Authenticated | Agent health metrics       |
| GET    | `/api/analytics/agents`             | Authenticated | Agent analytics overview   |
| GET    | `/api/analytics/agents/utilization` | Authenticated | Agent utilization metrics  |
| GET    | `/api/analytics/completion-time`    | Authenticated | Task completion time stats |
| GET    | `/api/analytics/cost/credits`       | Public        | Credit balance check       |
| GET    | `/api/analytics/cost/elevenlabs`    | Public        | ElevenLabs usage           |
| POST   | `/api/analytics/cost/ingest`        | Authenticated | Ingest cost data           |
| GET    | `/api/analytics/cost/limits`        | Authenticated | Cost limits                |
| GET    | `/api/analytics/cost`               | Authenticated | Cost overview              |
| GET    | `/api/analytics/cost/subscriptions` | Authenticated | Subscription costs         |
| GET    | `/api/analytics/cost/summary`       | Authenticated | Cost summary               |
| GET    | `/api/analytics/cost/trend`         | Authenticated | Cost trend over time       |
| GET    | `/api/analytics/dashboard`          | Authenticated | Dashboard analytics        |
| GET    | `/api/analytics/errors`             | Authenticated | Error analytics            |
| GET    | `/api/analytics/overview`           | Authenticated | Analytics overview         |
| GET    | `/api/analytics/priorities`         | Authenticated | Priority distribution      |
| POST   | `/api/analytics/usage/rollup`       | Authenticated | Roll up usage data         |
| GET    | `/api/analytics/usage`              | Authenticated | Usage analytics            |
| GET    | `/api/analytics/utilization`        | Authenticated | Overall utilization        |
| GET    | `/api/analytics/velocity`           | Authenticated | Team velocity metrics      |
| GET    | `/api/analytics/vercel`             | Public        | Vercel analytics proxy     |

## API Keys

| Method | Path                 | Auth          | Description    |
| ------ | -------------------- | ------------- | -------------- |
| DELETE | `/api/api-keys/[id]` | Authenticated | Revoke API key |
| PATCH  | `/api/api-keys/[id]` | Authenticated | Update API key |
| GET    | `/api/api-keys`      | Authenticated | List API keys  |
| POST   | `/api/api-keys`      | Authenticated | Create API key |

## Audit Log

| Method | Path             | Auth          | Description             |
| ------ | ---------------- | ------------- | ----------------------- |
| GET    | `/api/audit-log` | Authenticated | Query audit log entries |

## Auth

| Method | Path                      | Auth          | Description                   |
| ------ | ------------------------- | ------------- | ----------------------------- |
| POST   | `/api/auth/cli-exchange`  | Public        | CLI setup code exchange       |
| POST   | `/api/auth/cli-setup`     | Authenticated | Generate CLI setup token      |
| POST   | `/api/auth/cli-token`     | Public        | CLI token auth (rate-limited) |
| POST   | `/api/auth/device/code`   | Public        | Device auth — request code    |
| POST   | `/api/auth/device/token`  | Public        | Device auth — poll for token  |
| POST   | `/api/auth/device/verify` | Authenticated | Device auth — verify code     |
| POST   | `/api/auth/signout`       | Public        | Sign out (clear session)      |

## Billing

| Method | Path                        | Auth               | Description                    |
| ------ | --------------------------- | ------------------ | ------------------------------ |
| POST   | `/api/billing/checkout`     | Authenticated      | Create Stripe checkout session |
| GET    | `/api/billing/plans`        | Public             | List available plans           |
| POST   | `/api/billing/portal`       | Authenticated      | Create Stripe billing portal   |
| GET    | `/api/billing/subscription` | Authenticated      | Get current subscription       |
| GET    | `/api/billing/usage`        | Authenticated      | Get billing usage              |
| POST   | `/api/billing/webhook`      | Signature-verified | Stripe webhook handler         |

## Brain (Second Brain / Knowledge)

| Method | Path                                | Auth          | Description                     |
| ------ | ----------------------------------- | ------------- | ------------------------------- |
| POST   | `/api/brain/apply-updates`          | Authenticated | Apply brain updates             |
| GET    | `/api/brain/daily-plans`            | Authenticated | List daily plans                |
| POST   | `/api/brain/daily-plans`            | Authenticated | Create daily plan               |
| POST   | `/api/brain/extract-code`           | Authenticated | Extract code from brain context |
| POST   | `/api/brain/generate-summary`       | Authenticated | Generate brain summary          |
| GET    | `/api/brain/health`                 | Authenticated | Brain health check              |
| DELETE | `/api/brain/knowledge-sources/[id]` | Authenticated | Delete knowledge source         |
| GET    | `/api/brain/knowledge-sources/[id]` | Authenticated | Get knowledge source            |
| PATCH  | `/api/brain/knowledge-sources/[id]` | Authenticated | Update knowledge source         |
| GET    | `/api/brain/knowledge-sources`      | Authenticated | List knowledge sources          |
| POST   | `/api/brain/knowledge-sources`      | Authenticated | Create knowledge source         |
| GET    | `/api/brain/manifest`               | Authenticated | Get brain manifest              |
| POST   | `/api/brain/merge-preview`          | Authenticated | Preview brain merge             |
| POST   | `/api/brain/merge-resolve`          | Authenticated | Resolve brain merge conflict    |
| GET    | `/api/brain/settings`               | Authenticated | Get brain settings              |
| PATCH  | `/api/brain/settings`               | Authenticated | Update brain settings           |
| POST   | `/api/brain/tier-change`            | Public        | Brain tier change webhook       |
| GET    | `/api/brain/updates`                | Authenticated | List pending brain updates      |
| GET    | `/api/brain/vault-publish`          | Authenticated | Get vault publish status        |
| POST   | `/api/brain/vault-publish`          | Authenticated | Publish to vault                |
| DELETE | `/api/brain/vault-sync`             | Authenticated | Delete vault sync               |
| GET    | `/api/brain/vault-sync`             | Authenticated | Get vault sync status           |
| POST   | `/api/brain/vault-sync`             | Authenticated | Sync vault                      |
| GET    | `/api/brain/version`                | Authenticated | Get brain version               |
| POST   | `/api/brain/version`                | Authenticated | Create brain version            |

## Chat

| Method | Path                | Auth          | Description                 |
| ------ | ------------------- | ------------- | --------------------------- |
| POST   | `/api/chat/support` | Authenticated | Support chat (CORS-enabled) |

## Cron

| Method | Path                      | Auth          | Description        |
| ------ | ------------------------- | ------------- | ------------------ |
| GET    | `/api/cron/jobs`          | Authenticated | List cron jobs     |
| PATCH  | `/api/cron/jobs`          | Authenticated | Update cron job    |
| POST   | `/api/cron/run`           | CRON_SECRET   | Execute cron job   |
| POST   | `/api/cron/weekly-digest` | CRON_SECRET   | Send weekly digest |

## Discord

| Method | Path                             | Auth                      | Description                  |
| ------ | -------------------------------- | ------------------------- | ---------------------------- |
| GET    | `/api/discord/channels`          | Authenticated (Bearer)    | List channel-agent mappings  |
| PUT    | `/api/discord/channels`          | Authenticated (Bearer)    | Assign agent to channel      |
| POST   | `/api/discord/gateway-events`    | Signature (shared secret) | Gateway event forwarding     |
| GET    | `/api/discord/install`           | Public (redirect)         | OAuth2 install redirect      |
| POST   | `/api/discord/interactions`      | Signature (Ed25519)       | Discord interaction webhook  |
| GET    | `/api/discord/oauth/callback`    | Public (OAuth callback)   | OAuth2 code exchange         |
| POST   | `/api/discord/register-commands` | Service key               | Bulk register slash commands |

See [`apps/platform/src/app/api/discord/README.md`](src/app/api/discord/README.md) for setup guide.

## Executions

| Method | Path                       | Auth          | Description           |
| ------ | -------------------------- | ------------- | --------------------- |
| DELETE | `/api/executions/[id]`     | Authenticated | Delete execution      |
| GET    | `/api/executions/[id]`     | Authenticated | Get execution details |
| POST   | `/api/executions/[id]/run` | Authenticated | Run execution         |
| POST   | `/api/executions/cancel`   | Authenticated | Cancel execution      |
| GET    | `/api/executions`          | Authenticated | List executions       |

## Feature Flags

| Method | Path                | Auth          | Description              |
| ------ | ------------------- | ------------- | ------------------------ |
| GET    | `/api/flags/public` | Public        | Get public feature flags |
| GET    | `/api/flags`        | Authenticated | Get all feature flags    |

## GitHub

| Method | Path                                         | Auth               | Description                    |
| ------ | -------------------------------------------- | ------------------ | ------------------------------ |
| GET    | `/api/github/branches`                       | Authenticated      | List repo branches             |
| GET    | `/api/github/callback`                       | Public             | GitHub OAuth callback          |
| POST   | `/api/github/callback`                       | Public             | GitHub OAuth callback (POST)   |
| GET    | `/api/github/context`                        | Authenticated      | Get GitHub context             |
| GET    | `/api/github/detect-installation`            | Authenticated      | Detect GitHub App installation |
| GET    | `/api/github/file-conflicts`                 | Authenticated      | Check file conflicts           |
| GET    | `/api/github/install`                        | Authenticated      | GitHub App install redirect    |
| POST   | `/api/github/install`                        | Authenticated      | GitHub App install             |
| DELETE | `/api/github/installations/[installationId]` | Authenticated      | Remove installation            |
| GET    | `/api/github/installations/[installationId]` | Authenticated      | Get installation details       |
| DELETE | `/api/github/installations`                  | Authenticated      | Remove installations           |
| GET    | `/api/github/installations`                  | Authenticated      | List installations             |
| POST   | `/api/github/pr-review`                      | Authenticated      | Trigger PR review              |
| GET    | `/api/github/prs/[number]`                   | Authenticated      | Get PR details                 |
| PATCH  | `/api/github/prs/[number]`                   | Authenticated      | Update PR                      |
| GET    | `/api/github/prs`                            | Authenticated      | List PRs                       |
| POST   | `/api/github/prs`                            | Authenticated      | Create PR                      |
| GET    | `/api/github/repos`                          | Authenticated      | List repos                     |
| POST   | `/api/github/repos`                          | Authenticated      | Link repo                      |
| POST   | `/api/github/reviews/reply`                  | Authenticated      | Reply to review                |
| POST   | `/api/github/reviews`                        | Authenticated      | Submit review                  |
| POST   | `/api/github/sync-installation`              | Authenticated      | Sync installation              |
| POST   | `/api/github/webhooks`                       | Signature-verified | GitHub webhook handler         |

## Health

| Method | Path                          | Auth        | Description                |
| ------ | ----------------------------- | ----------- | -------------------------- |
| GET    | `/api/health`                 | Public      | Platform health check      |
| POST   | `/api/health/check-and-alert` | CRON_SECRET | Health check with alerting |
| GET    | `/api/health/mcps`            | Public      | MCP health status          |

## Hooks

| Method | Path                | Auth        | Description                    |
| ------ | ------------------- | ----------- | ------------------------------ |
| POST   | `/api/hooks/notify` | CRON_SECRET | Internal notification dispatch |

## Integrations

| Method | Path                               | Auth          | Description                |
| ------ | ---------------------------------- | ------------- | -------------------------- |
| DELETE | `/api/integrations/sentry/install` | Authenticated | Remove Sentry integration  |
| POST   | `/api/integrations/sentry/install` | Authenticated | Install Sentry integration |
| GET    | `/api/integrations/status`         | Authenticated | List integration statuses  |

## Invitations

| Method | Path                      | Auth          | Description       |
| ------ | ------------------------- | ------------- | ----------------- |
| DELETE | `/api/invitations/[id]`   | Authenticated | Revoke invitation |
| PUT    | `/api/invitations/[id]`   | Authenticated | Update invitation |
| POST   | `/api/invitations/accept` | Authenticated | Accept invitation |
| GET    | `/api/invitations`        | Authenticated | List invitations  |

## MCP (Model Context Protocol)

| Method | Path              | Auth          | Description             |
| ------ | ----------------- | ------------- | ----------------------- |
| DELETE | `/api/mcp`        | API key       | MCP resource operations |
| GET    | `/api/mcp`        | API key       | MCP resource operations |
| POST   | `/api/mcp`        | API key       | MCP resource operations |
| GET    | `/api/mcp/health` | Authenticated | MCP health check        |
| GET    | `/api/mcp/stream` | Authenticated | MCP SSE stream          |

## Memory

| Method | Path                                 | Auth          | Description                   |
| ------ | ------------------------------------ | ------------- | ----------------------------- |
| GET    | `/api/memory/contradictions`         | Authenticated | Detect memory contradictions  |
| DELETE | `/api/memory/entries/[id]`           | Authenticated | Delete memory entry           |
| GET    | `/api/memory/entries/[id]`           | Authenticated | Get memory entry              |
| PATCH  | `/api/memory/entries/[id]`           | Authenticated | Update memory entry           |
| DELETE | `/api/memory/entries/[id]/relations` | Authenticated | Delete memory relation        |
| GET    | `/api/memory/entries/[id]/relations` | Authenticated | List memory relations         |
| POST   | `/api/memory/entries/[id]/relations` | Authenticated | Create memory relation        |
| GET    | `/api/memory/entries`                | Authenticated | List memory entries           |
| POST   | `/api/memory/entries`                | Authenticated | Create memory entry           |
| GET    | `/api/memory/graph`                  | Authenticated | Get memory knowledge graph    |
| GET    | `/api/memory/heartbeat`              | Authenticated | Memory system heartbeat       |
| POST   | `/api/memory/ingest`                 | CRON_SECRET   | Bulk memory ingestion         |
| GET    | `/api/memory/limit`                  | Authenticated | Get memory usage limits       |
| GET    | `/api/memory/search`                 | Authenticated | Full-text memory search       |
| GET    | `/api/memory/semantic-search`        | Authenticated | Vector/semantic memory search |
| GET    | `/api/memory/stats`                  | Authenticated | Memory usage statistics       |

## Notifications

| Method | Path                                | Auth          | Description                     |
| ------ | ----------------------------------- | ------------- | ------------------------------- |
| POST   | `/api/notifications/dispatch`       | CRON_SECRET   | Dispatch notifications          |
| GET    | `/api/notifications/history`        | Authenticated | Notification history            |
| DELETE | `/api/notifications/preferences`    | Authenticated | Delete notification preference  |
| GET    | `/api/notifications/preferences`    | Authenticated | Get notification preferences    |
| PUT    | `/api/notifications/preferences`    | Authenticated | Update notification preferences |
| GET    | `/api/notifications/slack/callback` | Authenticated | Slack OAuth callback            |
| DELETE | `/api/notifications/slack/connect`  | Authenticated | Disconnect Slack                |
| GET    | `/api/notifications/slack/connect`  | Authenticated | Initiate Slack OAuth2           |
| GET    | `/api/notifications/slack/status`   | Authenticated | Slack connection status         |
| PATCH  | `/api/notifications/slack/status`   | Authenticated | Update Slack preferences        |
| POST   | `/api/notifications/test`           | Authenticated | Send test notification          |

## Onboarding

| Method | Path                                | Auth          | Description                   |
| ------ | ----------------------------------- | ------------- | ----------------------------- |
| GET    | `/api/onboarding/bootstrap`         | Authenticated | Get onboarding bootstrap data |
| POST   | `/api/onboarding/bootstrap`         | Authenticated | Initialize onboarding         |
| POST   | `/api/onboarding/chat`              | Authenticated | Onboarding chat message       |
| POST   | `/api/onboarding/confirm-profile`   | Authenticated | Confirm onboarding profile    |
| GET    | `/api/onboarding/conversation`      | Authenticated | Get onboarding conversation   |
| POST   | `/api/onboarding/exit`              | Authenticated | Exit onboarding               |
| GET    | `/api/onboarding/generate-projects` | Authenticated | Get generated projects        |
| POST   | `/api/onboarding/generate-projects` | Authenticated | Generate onboarding projects  |
| POST   | `/api/onboarding/generate`          | Authenticated | Generate onboarding content   |
| POST   | `/api/onboarding/profile`           | Authenticated | Save onboarding profile       |

## Organization

| Method | Path                          | Auth          | Description            |
| ------ | ----------------------------- | ------------- | ---------------------- |
| DELETE | `/api/org/agents/shared/[id]` | Authenticated | Remove shared agent    |
| PUT    | `/api/org/agents/shared/[id]` | Authenticated | Update shared agent    |
| GET    | `/api/org/agents/shared`      | Authenticated | List shared agents     |
| POST   | `/api/org/agents/shared`      | Authenticated | Share agent with org   |
| GET    | `/api/org/permissions`        | Authenticated | Get org permissions    |
| PUT    | `/api/org/permissions`        | Authenticated | Update org permissions |
| GET    | `/api/org/settings`           | Authenticated | Get org settings       |
| PUT    | `/api/org/settings`           | Authenticated | Update org settings    |
| POST   | `/api/org/transfer-ownership` | Authenticated | Transfer org ownership |

## Portfolio

| Method | Path                            | Auth          | Description               |
| ------ | ------------------------------- | ------------- | ------------------------- |
| DELETE | `/api/portfolio/passwords/[id]` | Authenticated | Delete portfolio password |
| PATCH  | `/api/portfolio/passwords/[id]` | Authenticated | Update portfolio password |
| GET    | `/api/portfolio/passwords`      | Authenticated | List portfolio passwords  |
| POST   | `/api/portfolio/passwords`      | Authenticated | Create portfolio password |
| POST   | `/api/portfolio/verify`         | Public (CORS) | Verify portfolio password |

## Projects

| Method | Path                       | Auth          | Description          |
| ------ | -------------------------- | ------------- | -------------------- |
| DELETE | `/api/projects/[id]/build` | Authenticated | Cancel project build |
| POST   | `/api/projects/[id]/build` | Authenticated | Start project build  |
| DELETE | `/api/projects/[id]`       | Authenticated | Delete project       |
| GET    | `/api/projects/[id]`       | Authenticated | Get project details  |
| PUT    | `/api/projects/[id]`       | Authenticated | Update project       |
| GET    | `/api/projects/progress`   | Authenticated | Get project progress |
| PUT    | `/api/projects/reorder`    | Authenticated | Reorder projects     |
| GET    | `/api/projects`            | Authenticated | List projects        |
| POST   | `/api/projects`            | Authenticated | Create project       |

## Project Groups

| Method | Path                          | Auth          | Description            |
| ------ | ----------------------------- | ------------- | ---------------------- |
| DELETE | `/api/project-groups/[id]`    | Authenticated | Delete project group   |
| GET    | `/api/project-groups/[id]`    | Authenticated | Get project group      |
| PUT    | `/api/project-groups/[id]`    | Authenticated | Update project group   |
| PUT    | `/api/project-groups/reorder` | Authenticated | Reorder project groups |
| GET    | `/api/project-groups`         | Authenticated | List project groups    |
| POST   | `/api/project-groups`         | Authenticated | Create project group   |

## Provider Keys (BYOK)

| Method | Path                        | Auth          | Description               |
| ------ | --------------------------- | ------------- | ------------------------- |
| DELETE | `/api/provider-keys/[id]`   | Authenticated | Delete provider key       |
| PATCH  | `/api/provider-keys/[id]`   | Authenticated | Update provider key       |
| GET    | `/api/provider-keys`        | Authenticated | List provider keys        |
| POST   | `/api/provider-keys`        | Authenticated | Store provider key        |
| GET    | `/api/provider-keys/status` | Authenticated | Check provider key status |

## Readiness

| Method | Path             | Auth          | Description               |
| ------ | ---------------- | ------------- | ------------------------- |
| GET    | `/api/readiness` | Authenticated | Workspace readiness check |

## Roles

| Method | Path         | Auth          | Description          |
| ------ | ------------ | ------------- | -------------------- |
| GET    | `/api/roles` | Authenticated | List available roles |

## Settings

| Method | Path                          | Auth          | Description                   |
| ------ | ----------------------------- | ------------- | ----------------------------- |
| GET    | `/api/settings/github-review` | Authenticated | Get GitHub review settings    |
| PATCH  | `/api/settings/github-review` | Authenticated | Update GitHub review settings |

## Skills

| Method | Path                   | Auth          | Description               |
| ------ | ---------------------- | ------------- | ------------------------- |
| DELETE | `/api/skills/[id]`     | Authenticated | Delete skill              |
| GET    | `/api/skills/[id]`     | Authenticated | Get skill details         |
| PATCH  | `/api/skills/[id]`     | Authenticated | Update skill              |
| GET    | `/api/skills/load`     | Authenticated | Load skills for agent     |
| GET    | `/api/skills`          | Authenticated | List skills               |
| POST   | `/api/skills`          | Authenticated | Create skill              |
| POST   | `/api/skills/validate` | Authenticated | Validate skill definition |

## Skill Packs

| Method | Path                              | Auth          | Description                |
| ------ | --------------------------------- | ------------- | -------------------------- |
| DELETE | `/api/skill-packs/[slug]/install` | Authenticated | Uninstall skill pack       |
| POST   | `/api/skill-packs/[slug]/install` | Authenticated | Install skill pack         |
| GET    | `/api/skill-packs`                | Authenticated | List available skill packs |

## Slack

| Method | Path                      | Auth               | Description                   |
| ------ | ------------------------- | ------------------ | ----------------------------- |
| POST   | `/api/slack/celune`       | Signature-verified | Celune bot message handler    |
| POST   | `/api/slack/commands`     | Signature-verified | Slash command handler         |
| POST   | `/api/slack/digest`       | CRON_SECRET        | Send daily/weekly digest      |
| POST   | `/api/slack/events`       | Signature-verified | Event subscription handler    |
| POST   | `/api/slack/interactions` | Signature-verified | Interactive component handler |

See [`apps/platform/src/app/api/slack/README.md`](src/app/api/slack/README.md) for setup guide.

## Support

| Method | Path                                | Auth          | Description                |
| ------ | ----------------------------------- | ------------- | -------------------------- |
| POST   | `/api/support/chat`                 | Authenticated | Support chat message       |
| POST   | `/api/support/contact`              | Public        | Contact form submission    |
| GET    | `/api/support/conversations`        | Authenticated | List support conversations |
| GET    | `/api/support/feedback`             | Authenticated | List feedback entries      |
| PATCH  | `/api/support/feedback`             | Authenticated | Update feedback entry      |
| POST   | `/api/support/feedback`             | Authenticated | Submit feedback            |
| GET    | `/api/support/tickets`              | Authenticated | List support tickets       |
| PATCH  | `/api/support/tickets`              | Authenticated | Update support ticket      |
| POST   | `/api/support/tickets`              | Authenticated | Create support ticket      |
| GET    | `/api/support/triage/[id]/messages` | Authenticated | Get triage messages        |
| GET    | `/api/support/triage`               | Authenticated | List triage queue          |

## Tasks

| Method | Path                                         | Auth          | Description           |
| ------ | -------------------------------------------- | ------------- | --------------------- |
| DELETE | `/api/tasks/[id]/attachments/[attachmentId]` | Authenticated | Delete attachment     |
| GET    | `/api/tasks/[id]/attachments`                | Authenticated | List task attachments |
| POST   | `/api/tasks/[id]/attachments`                | Authenticated | Upload attachment     |
| GET    | `/api/tasks/[id]/children`                   | Authenticated | List subtasks         |
| GET    | `/api/tasks/[id]/comments`                   | Authenticated | List task comments    |
| POST   | `/api/tasks/[id]/comments`                   | Authenticated | Add task comment      |
| GET    | `/api/tasks/[id]/context`                    | Authenticated | Get task context      |
| DELETE | `/api/tasks/[id]`                            | Authenticated | Delete task           |
| GET    | `/api/tasks/[id]`                            | Authenticated | Get task details      |
| PUT    | `/api/tasks/[id]`                            | Authenticated | Update task           |
| POST   | `/api/tasks/batch`                           | Authenticated | Batch task operations |
| GET    | `/api/tasks`                                 | Authenticated | List tasks            |
| POST   | `/api/tasks`                                 | Authenticated | Create task           |

## Users

| Method | Path                     | Auth          | Description              |
| ------ | ------------------------ | ------------- | ------------------------ |
| PUT    | `/api/users/[id]/role`   | Authenticated | Update user role         |
| DELETE | `/api/users/[id]`        | Authenticated | Delete user (owner-only) |
| PUT    | `/api/users/[id]/status` | Authenticated | Update user status       |
| GET    | `/api/users/platform`    | Authenticated | Get platform user info   |
| GET    | `/api/users`             | Authenticated | List workspace users     |

## Voice

| Method | Path                    | Auth          | Description          |
| ------ | ----------------------- | ------------- | -------------------- |
| POST   | `/api/voice/parse`      | Authenticated | Parse voice input    |
| POST   | `/api/voice/preview`    | Authenticated | Preview voice output |
| POST   | `/api/voice/transcribe` | Authenticated | Transcribe audio     |

## Waitlist

| Method | Path            | Auth          | Description           |
| ------ | --------------- | ------------- | --------------------- |
| GET    | `/api/waitlist` | Authenticated | List waitlist entries |
| PATCH  | `/api/waitlist` | Authenticated | Update waitlist entry |
| POST   | `/api/waitlist` | Authenticated | Add to waitlist       |

## Webhooks

| Method | Path                             | Auth               | Description              |
| ------ | -------------------------------- | ------------------ | ------------------------ |
| POST   | `/api/webhooks/agentmail`        | Signature-verified | AgentMail webhook        |
| DELETE | `/api/webhooks/endpoints/[id]`   | Authenticated      | Delete webhook endpoint  |
| PATCH  | `/api/webhooks/endpoints/[id]`   | Authenticated      | Update webhook endpoint  |
| GET    | `/api/webhooks/endpoints`        | Authenticated      | List webhook endpoints   |
| POST   | `/api/webhooks/endpoints`        | Authenticated      | Create webhook endpoint  |
| POST   | `/api/webhooks/retry`            | CRON_SECRET        | Retry failed webhooks    |
| POST   | `/api/webhooks/sentry/heartbeat` | Signature-verified | Sentry heartbeat webhook |
| POST   | `/api/webhooks/sentry`           | Signature-verified | Sentry event webhook     |

## Workspace

| Method | Path                             | Auth          | Description                 |
| ------ | -------------------------------- | ------------- | --------------------------- |
| DELETE | `/api/workspace-members/[id]`    | Authenticated | Remove workspace member     |
| PATCH  | `/api/workspace-members/[id]`    | Authenticated | Update workspace member     |
| GET    | `/api/workspace-members`         | Authenticated | List workspace members      |
| POST   | `/api/workspace-state`           | Authenticated | Update workspace state      |
| GET    | `/api/workspace/getting-started` | Authenticated | Get onboarding checklist    |
| POST   | `/api/workspace/getting-started` | Authenticated | Update onboarding checklist |
| GET    | `/api/workspace/setup-status`    | Authenticated | Get workspace setup status  |

---

## Security Summary

- **163+ route files** with automated security invariant testing
- All write routes require CSRF validation (via `validateOrigin` or `withApiSecurity`) unless explicitly exempt
- All write routes require rate limiting (via `applyRateLimit` or `withApiSecurity`) unless explicitly exempt
- All routes require authentication unless explicitly exempt
- Webhook routes use signature verification (Ed25519, HMAC-SHA256, or shared secret) instead of CSRF
- Cron routes use `CRON_SECRET` bearer token auth
- MCP routes use API key auth
- See `apps/platform/src/app/api/__tests__/security-invariants.test.ts` for the full security enforcement test
