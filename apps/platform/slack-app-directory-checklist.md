# Slack App Directory Submission Checklist

## Pre-Submission Requirements

### App Configuration

- [ ] App manifest deployed (see `slack-app-manifest.yaml`)
- [ ] Bot user display name: "Celune"
- [ ] App icon: 512x512 PNG (use Celune brand mark on dark background)
- [ ] App icon (small): 96x96 PNG
- [ ] Background color: `#1a1a1a`
- [ ] Always online: enabled

### OAuth & Security

- [ ] OAuth redirect URL: `https://app.celune.ai/api/notifications/slack/callback`
- [ ] Bot scopes: `chat:write`, `commands`, `im:history`, `im:read`, `im:write`, `app_mentions:read`, `users:read`
- [ ] No user token scopes (bot-only)
- [ ] HMAC-SHA256 signature verification on all endpoints
- [ ] Replay protection (5-minute window)
- [ ] Bot tokens encrypted at rest (AES-256-GCM)
- [ ] Token rotation: disabled (manage via re-auth)

### Event Subscriptions

- [ ] Events URL: `https://app.celune.ai/api/slack/events`
- [ ] URL verification challenge handler working
- [ ] Bot events: `app_home_opened`, `app_mention`, `message.im`, `tokens_revoked`, `app_uninstalled`
- [ ] 3-second ack deadline met (fire-and-forget async processing)

### Slash Commands

- [ ] `/celune` command registered
- [ ] Request URL: `https://app.celune.ai/api/slack/celune`
- [ ] Usage hint: `[status | help | task create <title> | task list | project list]`
- [ ] Commands respond within 3 seconds

### Interactivity

- [ ] Interactivity enabled
- [ ] Request URL: `https://app.celune.ai/api/slack/interactions`
- [ ] Button actions handled (view_dashboard, view_task, celune_dashboard)

## App Directory Listing Content

### Short Description (140 chars max)

> AI-powered project management with autonomous agents. Get task updates and manage projects from Slack.

### Category

- Productivity
- Project Management

### Support URL

- `https://docs.celune.ai/support`

### Privacy Policy URL

- `https://celune.ai/privacy`

### Installation Landing Page

- `https://celune.ai/integrations/slack`

### Screenshots (3-5 required)

1. Home Tab showing agent panel with status grid and recent tasks
2. Notification message with interactive "View Task" button
3. `/celune status` command showing task counts
4. `/celune task create` creating a task from Slack
5. Conversation thread with agent reply

## Slack Review Checklist (from Slack's requirements)

### Functionality

- [ ] App works correctly after installation
- [ ] All advertised features function as described
- [ ] Error states are handled gracefully (no raw errors shown to users)
- [ ] App responds to uninstall events (marks connection inactive)
- [ ] App responds to token revocation events

### User Experience

- [ ] Home Tab provides immediate value after install
- [ ] Slash command help is discoverable (`/celune help`)
- [ ] Messages use Block Kit formatting (not plain text)
- [ ] Notification frequency is reasonable (not spammy)
- [ ] Users can configure notification preferences

### Security

- [ ] All requests verified via HMAC-SHA256
- [ ] No sensitive data in URLs or query parameters
- [ ] Tokens stored encrypted
- [ ] Rate limiting in place (20 commands/min per workspace)
- [ ] No data shared between workspaces (multi-tenant isolation)

### Performance

- [ ] All endpoints respond within 3 seconds
- [ ] Async processing for heavy operations
- [ ] Rate limiting prevents abuse

## Post-Submission

- [ ] Monitor review status (typically 1-2 weeks)
- [ ] Address reviewer feedback within 48 hours
- [ ] Test installation flow from App Directory after approval
- [ ] Announce availability in changelog and marketing
