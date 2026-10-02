# Slack Integration

Celune's Slack integration provides slash commands, event subscriptions, interactive components, and automated digests for connected workspaces.

## Architecture

```
Slack ──► Commands (POST /api/slack/commands)
       ├── HMAC signature verification (SLACK_SIGNING_SECRET)
       └── /celune and /remote slash commands

Slack ──► Events (POST /api/slack/events)
       ├── HMAC signature verification
       └── Event subscriptions (url_verification, app_mention, etc.)

Slack ──► Interactions (POST /api/slack/interactions)
       ├── HMAC signature verification
       └── Button clicks, modal submissions, action responses

Slack ──► Celune Bot (POST /api/slack/celune)
       ├── HMAC signature verification
       └── Direct messages to the Celune bot

Cron  ──► Digest (POST /api/slack/digest?type=daily|weekly)
       ├── CRON_SECRET or service key auth
       └── Sends activity digests to connected channels
```

## Creating a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name it (e.g., "Celune AI") and select your workspace
4. Under **Basic Information**:
   - Copy **Client ID** → `SLACK_CLIENT_ID`
   - Copy **Client Secret** → `SLACK_CLIENT_SECRET`
   - Copy **Signing Secret** → `SLACK_SIGNING_SECRET`

## Required Scopes (Bot Token)

Under **OAuth & Permissions** → **Bot Token Scopes**, add:

| Scope               | Purpose                               |
| ------------------- | ------------------------------------- |
| `chat:write`        | Send messages and digests             |
| `commands`          | Respond to slash commands             |
| `app_mentions:read` | React to @Celune mentions             |
| `channels:read`     | List channels for connection picker   |
| `groups:read`       | List private channels (if enabled)    |
| `im:read`           | Read direct messages                  |
| `im:write`          | Send direct messages                  |
| `users:read`        | Resolve user display names in digests |

## Event Subscriptions

Under **Event Subscriptions**:

1. Enable Events
2. Set **Request URL**: `https://<your-app-domain>/api/slack/events`
3. Subscribe to bot events:
   - `app_mention` — when users @mention the bot
   - `message.im` — direct messages to the bot

Slack will send a `url_verification` challenge on save — the events route handles this automatically.

## Slash Commands

Under **Slash Commands**, create:

| Command   | Request URL                                    | Description                  |
| --------- | ---------------------------------------------- | ---------------------------- |
| `/celune` | `https://<your-app-domain>/api/slack/commands` | Celune AI — tasks and memory |
| `/remote` | `https://<your-app-domain>/api/slack/commands` | Remote ops (deploy, status)  |

## Interactivity

Under **Interactivity & Shortcuts**:

1. Enable Interactivity
2. Set **Request URL**: `https://<your-app-domain>/api/slack/interactions`

This handles button clicks, modal submissions, and action responses from Slack messages.

## OAuth2 / Install Flow

Celune uses the **Notifications** settings page to connect Slack:

1. User clicks "Connect Slack" in workspace settings
2. Redirects to Slack OAuth2 (`GET /api/notifications/slack/connect`)
3. User authorizes the app
4. Callback stores the bot token (encrypted with `WEBHOOK_ENCRYPTION_KEY`) and channel preferences

**OAuth Redirect URL** (add in Slack app settings):

```
https://<your-app-domain>/api/notifications/slack/callback
```

## Notification / Digest Configuration

Connected workspaces can configure:

- **Daily digest** — summary of tasks completed, created, and in-progress (triggered by cron)
- **Weekly digest** — weekly velocity, project progress, and highlights (triggered by cron)
- **Real-time notifications** — task assignments, status changes, mentions

Digests are triggered via:

```bash
# Daily digest (e.g., Vercel Cron at 9am UTC)
curl -X POST "https://<your-app-domain>/api/slack/digest?type=daily" \
  -H "Authorization: Bearer $CRON_SECRET"

# Weekly digest (e.g., Vercel Cron on Monday 9am UTC)
curl -X POST "https://<your-app-domain>/api/slack/digest?type=weekly" \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Environment Variables

| Variable                        | Required | Description                                          |
| ------------------------------- | -------- | ---------------------------------------------------- |
| `SLACK_CLIENT_ID`               | Yes      | Slack app client ID                                  |
| `SLACK_CLIENT_SECRET`           | Yes      | Slack app client secret                              |
| `SLACK_SIGNING_SECRET`          | Yes      | HMAC signing secret for request verification         |
| `SLACK_ALLOWED_USER_IDS`        | No       | Comma-separated user IDs allowed to use `/remote`    |
| `VERCEL_DEPLOY_HOOK`            | No       | Vercel deploy hook URL for `/remote deploy`          |
| `WEBHOOK_ENCRYPTION_KEY`        | No       | AES-256-GCM key for encrypting stored bot tokens     |
| `NEXT_PUBLIC_SLACK_CHANNEL_URL` | No       | Public Slack channel URL for marketing/support links |

## API Routes

| Method | Path                                | Auth                      | Description                     |
| ------ | ----------------------------------- | ------------------------- | ------------------------------- |
| POST   | `/api/slack/commands`               | HMAC signature            | Slash command handler           |
| POST   | `/api/slack/events`                 | HMAC signature            | Event subscriptions             |
| POST   | `/api/slack/interactions`           | HMAC signature            | Interactive component callbacks |
| POST   | `/api/slack/celune`                 | HMAC signature            | Direct bot message handler      |
| POST   | `/api/slack/digest`                 | CRON_SECRET / service key | Automated digest sender         |
| GET    | `/api/notifications/slack/connect`  | Authenticated             | Initiate Slack OAuth2 flow      |
| DELETE | `/api/notifications/slack/connect`  | Authenticated             | Disconnect Slack                |
| GET    | `/api/notifications/slack/callback` | Authenticated             | OAuth2 callback                 |
| GET    | `/api/notifications/slack/status`   | Authenticated             | Check connection status         |
| PATCH  | `/api/notifications/slack/status`   | Authenticated             | Update notification preferences |

## Security

All Slack webhook routes verify the `X-Slack-Signature` header using HMAC-SHA256 with `SLACK_SIGNING_SECRET`. This replaces CSRF validation for these endpoints.

Bot tokens are encrypted at rest using AES-256-GCM when `WEBHOOK_ENCRYPTION_KEY` is set.
