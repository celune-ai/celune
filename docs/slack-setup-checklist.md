# Slack App Setup Checklist

## Prerequisites

- [ ] Celune platform deployed and accessible (e.g., `https://app.celune.ai`)
- [ ] Supabase project running with `slack_connections` table
- [ ] `WEBHOOK_ENCRYPTION_KEY` set in environment (for bot token encryption)

## 1. Create the Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**
2. Choose **From scratch**, name it (e.g., "Celune"), pick your workspace
3. Copy the **App ID** from the Basic Information page

## 2. Configure OAuth & Permissions

Under **OAuth & Permissions**, add these Bot Token Scopes:

| Scope               | Purpose                                  |
| ------------------- | ---------------------------------------- |
| `chat:write`        | Send messages and notifications          |
| `commands`          | Handle slash commands                    |
| `users:read`        | Resolve user names for activity          |
| `im:history`        | Read DM history for conversation context |
| `im:write`          | Open/send DMs to users                   |
| `app_mentions:read` | Respond to @mentions                     |

Set the **Redirect URL** to: `https://app.celune.ai/api/slack/oauth/callback`

## 3. Set Environment Variables

```bash
SLACK_CLIENT_ID=<from Basic Information>
SLACK_CLIENT_SECRET=<from Basic Information>
SLACK_SIGNING_SECRET=<from Basic Information>
```

## 4. Configure Slash Commands

Create these commands under **Slash Commands**:

| Command   | Request URL                                | Description               |
| --------- | ------------------------------------------ | ------------------------- |
| `/celune` | `https://app.celune.ai/api/slack/commands` | Celune workspace commands |
| `/remote` | `https://app.celune.ai/api/slack/celune`   | Remote admin commands     |

## 5. Configure Event Subscriptions

Under **Event Subscriptions**:

1. Enable Events
2. Set Request URL: `https://app.celune.ai/api/slack/events`
3. Wait for URL verification (challenge/response)
4. Subscribe to bot events:
   - `message.im` — DM conversations
   - `app_mention` — @celune mentions
   - `app_home_opened` — Home Tab views
   - `tokens_revoked` — Token cleanup
   - `app_uninstalled` — Uninstall cleanup

## 6. Configure Interactivity

Under **Interactivity & Shortcuts**:

1. Enable Interactivity
2. Set Request URL: `https://app.celune.ai/api/slack/interactions`

## 7. Configure App Home

Under **App Home**:

1. Enable **Home Tab**
2. Enable **Messages Tab** (allow users to send DMs)

## 8. Install to Workspace

1. Go to **Install App** and click **Install to Workspace**
2. Authorize the app
3. The bot token will be encrypted and stored automatically via the OAuth callback

## 9. Verify Installation

- [ ] Home Tab loads with agent status and quick actions
- [ ] `/celune status` returns task counts
- [ ] `/celune help` returns command list
- [ ] DM to the bot gets an acknowledgment reply
- [ ] @celune mention in a channel triggers a response

## 10. Optional: WARD Integration (Sentry)

If using the WARD auto-fix agent:

1. In Sentry, go to **Settings > Integrations > Webhooks**
2. Set the webhook URL: `https://app.celune.ai/api/webhooks/sentry`
3. Set `SENTRY_WEBHOOK_SECRET` to the Sentry client secret
4. Enable issue alerts to trigger on new errors
5. WARD will send Slack messages with Merge/Reject buttons when fixes are ready

## Troubleshooting

- **401 on events/interactions**: Check `SLACK_SIGNING_SECRET` matches the app's signing secret
- **Bot doesn't respond to DMs**: Verify `message.im` is subscribed and `im:history` scope is granted
- **Home Tab blank**: Check bot token decryption — verify `WEBHOOK_ENCRYPTION_KEY` is set
- **WARD buttons don't work**: Verify Interactivity URL points to `/api/slack/interactions`
