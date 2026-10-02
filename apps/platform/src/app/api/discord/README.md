# Discord Integration

Celune's Discord integration provides slash commands, OAuth2 bot installation, and passive memory ingestion via a standalone gateway process.

## Architecture

```
Discord ──► Interactions Webhook (POST /api/discord/interactions)
         ├── Ed25519 signature verification
         └── Slash command dispatch (/celune task, /celune project, /celune memory, /celune ask)

Discord ──► Gateway Process (standalone, Railway/Fly.io)
         ├── Connects via WebSocket (Gateway v10)
         ├── Forwards MESSAGE_CREATE events to POST /api/discord/gateway-events
         └── Authenticated with DISCORD_GATEWAY_SECRET shared header

Platform ──► OAuth2 Install Flow
          ├── GET  /api/discord/install (redirect to Discord OAuth2)
          ├── GET  /api/discord/oauth/callback (exchange code, store connection)
          └── POST /api/discord/register-commands (bulk overwrite slash commands)
```

## Creating a Discord Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** and name it (e.g., "Celune AI")
3. Under **General Information**:
   - Copy **Application ID** → `DISCORD_APPLICATION_ID`
   - Copy **Public Key** → `DISCORD_PUBLIC_KEY`
4. Under **Bot**:
   - Click **Reset Token** and copy → `DISCORD_BOT_TOKEN`
   - Enable **Message Content Intent** under Privileged Gateway Intents
5. Under **OAuth2 > General**:
   - Copy **Client Secret** → `DISCORD_CLIENT_SECRET`
   - Add redirect URL: `https://<your-app-domain>/api/discord/oauth/callback`

## Required Bot Permissions

The bot requires permission integer `2147485696`, which includes:

| Permission           | Bit       | Purpose                                   |
| -------------------- | --------- | ----------------------------------------- |
| Send Messages        | `1 << 11` | Respond to commands and proactive replies |
| Embed Links          | `1 << 14` | Rich embeds for task/project summaries    |
| Read Message History | `1 << 16` | Context for proactive responses           |
| Use Slash Commands   | `1 << 31` | `/celune` command tree                    |

## Required Intents

| Intent          | Privileged | Purpose                                |
| --------------- | ---------- | -------------------------------------- |
| Guilds          | No         | Track guild membership                 |
| Guild Messages  | No         | Receive message events                 |
| Message Content | Yes        | Read message text for memory ingestion |

## OAuth2 Setup

**Scopes**: `bot`, `applications.commands`, `identify`

The install flow (`GET /api/discord/install`) constructs the OAuth2 URL with:

- `response_type=code`
- `scope=bot applications.commands identify`
- `permissions=2147485696`
- `state=base64({ workspace_id, user_id })`

The callback (`GET /api/discord/oauth/callback`) exchanges the code for tokens and stores the connection in the `discord_connections` table.

## Slash Command Registration

Run once after creating the app (or after updating command definitions):

```bash
curl -X POST https://<your-app-domain>/api/discord/register-commands \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

This uses Discord's bulk overwrite endpoint (`PUT /applications/{app_id}/commands`) to register:

| Command                 | Description                        |
| ----------------------- | ---------------------------------- |
| `/celune task list`     | List tasks by status               |
| `/celune task create`   | Create a new task                  |
| `/celune task update`   | Update task status/priority        |
| `/celune project list`  | List active projects               |
| `/celune project show`  | Show project details               |
| `/celune memory search` | Search workspace memory            |
| `/celune memory store`  | Store a memory entry               |
| `/celune ask`           | Ask Celune a question (agent chat) |

## Interactions Webhook

**URL**: `https://<your-app-domain>/api/discord/interactions`

Configure in Discord Developer Portal → General Information → **Interactions Endpoint URL**.

This endpoint:

1. Verifies the Ed25519 signature using `DISCORD_PUBLIC_KEY`
2. Responds to PING challenges (type 1)
3. Dispatches slash commands (type 2) to the appropriate handler
4. Returns deferred responses for long-running operations

## Gateway Setup (v2 — Passive Memory)

The gateway is a standalone process that connects to Discord's WebSocket gateway, listens for messages in connected servers, and forwards them to the platform for memory ingestion and proactive responses.

### Deployment (Railway / Fly.io)

The gateway process runs separately from the Next.js app because Vercel functions are stateless and cannot maintain WebSocket connections.

**Required environment variables for the gateway process:**

```env
DISCORD_BOT_TOKEN=        # Same bot token as the platform
DISCORD_GATEWAY_SECRET=   # Shared secret (must match platform env)
PLATFORM_API_URL=         # e.g., https://<your-app-domain>/api/discord/gateway-events
```

The gateway authenticates with the platform via the `x-gateway-secret` header.

### Event Flow

1. Gateway connects to `wss://gateway.discord.gg/?v=10&encoding=json`
2. On `MESSAGE_CREATE`, forwards the event to `POST /api/discord/gateway-events`
3. Platform ingests the message into workspace memory (FTS + optional vector)
4. Platform evaluates proactive response criteria (mentions, questions, relevant context)
5. If triggered, sends a contextual reply back through the Discord REST API

## Environment Variables

| Variable                 | Required | Description                                        |
| ------------------------ | -------- | -------------------------------------------------- |
| `DISCORD_APPLICATION_ID` | Yes      | Application/Client ID from Developer Portal        |
| `DISCORD_PUBLIC_KEY`     | Yes      | Ed25519 key for interaction signature verification |
| `DISCORD_BOT_TOKEN`      | Yes      | Bot token for REST API calls                       |
| `DISCORD_CLIENT_SECRET`  | Yes      | OAuth2 secret for authorization code exchange      |
| `DISCORD_GATEWAY_SECRET` | Yes      | Shared secret between gateway process and platform |
| `WEBHOOK_ENCRYPTION_KEY` | No       | AES-256-GCM key for encrypting stored bot tokens   |

## API Routes

| Method | Path                             | Auth                    | Description                  |
| ------ | -------------------------------- | ----------------------- | ---------------------------- |
| POST   | `/api/discord/interactions`      | Ed25519 signature       | Discord interaction webhook  |
| POST   | `/api/discord/gateway-events`    | `x-gateway-secret`      | Gateway event forwarding     |
| GET    | `/api/discord/install`           | Public (redirects)      | OAuth2 install redirect      |
| GET    | `/api/discord/oauth/callback`    | Public (OAuth callback) | OAuth2 code exchange + store |
| POST   | `/api/discord/register-commands` | Service role key        | Bulk register slash commands |
| GET    | `/api/discord/channels`          | Bearer token            | List channel-agent mappings  |
| PUT    | `/api/discord/channels`          | Bearer token            | Assign agent to channel      |
