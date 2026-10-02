# @repo/discord-gateway

Standalone Discord Gateway process that maintains a persistent WebSocket connection to Discord's Gateway API. Required because Vercel functions are stateless and cannot hold WebSocket connections. Deployed separately on Railway.

## How It Works

1. Connects to Discord Gateway via WebSocket (`ws` library)
2. Authenticates with bot token and subscribes to guild events
3. Listens for `MESSAGE_CREATE` and other events in connected servers
4. Forwards events to the platform API (`POST /api/discord/gateway-events`) with a shared secret header (`x-gateway-secret`)
5. Handles heartbeat, reconnection, and session resumption automatically

## Key Files

| File           | Purpose                                             |
| -------------- | --------------------------------------------------- |
| `src/index.ts` | Gateway client — connect, heartbeat, event dispatch |
| `Dockerfile`   | Container image for Railway deployment              |
| `railway.json` | Railway deployment configuration                    |

## Environment Variables

| Variable                 | Required | Description                                                 |
| ------------------------ | -------- | ----------------------------------------------------------- |
| `DISCORD_BOT_TOKEN`      | Yes      | Bot token (same as platform env)                            |
| `DISCORD_GATEWAY_SECRET` | Yes      | Shared secret (must match platform env)                     |
| `PLATFORM_API_URL`       | Yes      | e.g. `https://<your-app-domain>/api/discord/gateway-events` |

## Development

```bash
pnpm --filter @repo/discord-gateway dev    # Run with tsx
pnpm --filter @repo/discord-gateway build  # Compile TypeScript
pnpm --filter @repo/discord-gateway start  # Run compiled output
```

## Deployment

Deployed as a long-running process on Railway (not Vercel). The `Dockerfile` and `railway.json` handle container configuration.

```bash
# Deploy via Railway CLI
railway up
```
