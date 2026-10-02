# Slack App Setup Checklist

Complete setup guide for the Celune Slack App integration.

## 1. Create the Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** > **From scratch**
3. Name: `Celune` (or `Celune Dev` for development)
4. Select the workspace to install into
5. Note the **App ID**, **Client ID**, **Client Secret**, and **Signing Secret**

## 2. Configure OAuth Scopes

Under **OAuth & Permissions** > **Bot Token Scopes**, add:

| Scope                  | Purpose                              |
| ---------------------- | ------------------------------------ |
| `chat:write`           | Send messages as the bot             |
| `chat:write.customize` | Custom bot name/icon per workspace   |
| `commands`             | Register slash commands              |
| `app_mentions:read`    | Receive @celune mentions             |
| `im:history`           | Read DM conversation history         |
| `im:read`              | View DM metadata                     |
| `im:write`             | Start DMs with users                 |
| `users:read`           | Look up user info (display names)    |
| `users:read.email`     | Match Slack users to Celune accounts |

**User Token Scopes** (optional, not currently used):

- None required for current functionality.

## 3. Set Request URLs

### Event Subscriptions

Under **Event Subscriptions**, enable events and set:

- **Request URL**: `https://app.celune.ai/api/slack/events`

The endpoint handles URL verification automatically.

### Interactive Components

Under **Interactivity & Shortcuts**, enable and set:

- **Request URL**: `https://app.celune.ai/api/slack/interactions`

### Slash Commands

Under **Slash Commands**, create:

| Command   | Request URL                                | Description                              |
| --------- | ------------------------------------------ | ---------------------------------------- |
| `/celune` | `https://app.celune.ai/api/slack/celune`   | Main Celune command (status, task, help) |
| `/remote` | `https://app.celune.ai/api/slack/commands` | Remote agent commands                    |

## 4. Subscribe to Bot Events

Under **Event Subscriptions** > **Subscribe to bot events**, add:

| Event             | Description                          |
| ----------------- | ------------------------------------ |
| `message.im`      | DMs sent to the bot                  |
| `app_mention`     | @celune mentions in channels         |
| `app_home_opened` | User opens the Home Tab              |
| `tokens_revoked`  | OAuth tokens revoked (cleanup)       |
| `app_uninstalled` | App removed from workspace (cleanup) |

## 5. Enable Home Tab

Under **App Home**:

- [x] **Home Tab** — Enable
- [ ] **Messages Tab** — Optional (DMs work regardless)
- [x] Check "Allow users to send Slash commands and messages from the messages tab"

## 6. Environment Variables

Add to `apps/platform/.env.local` (see `.env.example`):

```bash
# Slack App credentials (from app settings > Basic Information)
SLACK_CLIENT_ID=your_client_id
SLACK_CLIENT_SECRET=your_client_secret
SLACK_SIGNING_SECRET=your_signing_secret

# Bot token encryption (for storing tokens in Supabase)
# Must match the key used by @repo/notifications/decrypt-webhook
WEBHOOK_ENCRYPTION_KEY=your_32_byte_hex_key
```

The bot token itself is obtained during OAuth install flow and stored encrypted in `slack_connections`.

## 7. OAuth Install Flow

The install flow is handled by:

- **Install URL**: `https://app.celune.ai/api/slack/install` (redirects to Slack OAuth)
- **Redirect URL**: `https://app.celune.ai/api/slack/callback` (exchanges code for token)

Configure the redirect URL in Slack app settings under **OAuth & Permissions** > **Redirect URLs**:

```
https://app.celune.ai/api/slack/callback
```

## 8. Distribution Settings (Multi-Tenant)

If distributing beyond a single workspace:

1. Under **Manage Distribution**, enable public distribution
2. Remove any hard-coded IP restrictions
3. Ensure the OAuth install flow stores `team_id` in `slack_connections`
4. Each workspace gets its own encrypted bot token

## 9. Database Tables

The Slack integration uses these Supabase tables:

| Table                 | Purpose                                                 |
| --------------------- | ------------------------------------------------------- |
| `slack_connections`   | OAuth tokens (encrypted), workspace mapping, bot config |
| `slack_conversations` | DM/mention conversation history for agent context       |
| `activity_log`        | Audit trail for Slack interactions                      |

## 10. Verification

After setup, verify each component:

- [ ] `/api/slack/events` — Send a test DM to the bot, confirm it appears in `slack_conversations`
- [ ] `/api/slack/interactions` — Click a Home Tab button, confirm action is processed
- [ ] `/api/slack/celune` — Run `/celune help` in Slack
- [ ] Home Tab — Open the app home, confirm blocks render
- [ ] Agent reply — Send a DM, confirm bot replies in-thread
- [ ] Token revocation — Revoke tokens in Slack, confirm `slack_connections.is_active` flips to `false`
