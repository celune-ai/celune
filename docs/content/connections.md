# Connections & Integrations

Connect your tools to Celune so your agents can work alongside you. This guide covers every integration available today — most take under two minutes to set up.

---

## 1. IDE Connection (MCP)

Celune uses the **Model Context Protocol (MCP)** to connect directly to your IDE. Once connected, your AI coding assistant can read and manage your Celune tasks, projects, and memory without leaving the editor.

### Quick Setup

Open your terminal and run:

```bash
npx @celuneai/cli setup
```

The CLI auto-detects your IDE (Cursor, VS Code, or Windsurf) and writes the correct MCP configuration file. No manual editing required.

### What Happens Under the Hood

1. An API key is generated for your workspace.
2. The CLI writes an MCP server entry pointing to `https://app.celune.ai/api/mcp` with your API key.
3. Your IDE picks up the new server on its next restart (or reload).

### Available MCP Tools

Once connected, your IDE's AI assistant gains access to these tools:

| Tool                 | Description                           |
| -------------------- | ------------------------------------- |
| `whoami`             | Show current user and role            |
| `get_workspace_info` | Workspace details and plan            |
| `list_tasks`         | List tasks (with filters)             |
| `get_task`           | Get a single task by ID               |
| `create_task`        | Create a new task                     |
| `claim_task`         | Assign a task to yourself             |
| `complete_task`      | Mark a task as done                   |
| `block_task`         | Flag a task as blocked                |
| `add_comment`        | Add a comment to a task               |
| `list_projects`      | List projects in the workspace        |
| `get_project`        | Get project details with task summary |
| `create_project`     | Create a new project                  |
| `recall_memory`      | Search agent memory                   |
| `list_memories`      | Browse memory entries                 |
| `store_memory`       | Save a new memory entry               |

### Manual Setup (Advanced)

If you prefer to configure manually, add this entry to your IDE's MCP config:

**Cursor** — `~/.cursor/mcp.json`
**VS Code** — `~/.vscode/mcp.json`
**Windsurf** — `~/.codeium/windsurf/mcp_config.json`

```json
{
  "mcpServers": {
    "celune": {
      "url": "https://app.celune.ai/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

Generate an API key from **Settings > API Keys** in the Celune dashboard.

### Troubleshooting

- **"Could not check connection"** — Restart your IDE after setup. MCP servers are loaded at startup.
- **Tools not appearing** — Verify your API key is active in Settings > API Keys. Revoked keys will silently fail.
- **Wrong workspace** — Each API key is scoped to one workspace. If you switch workspaces, run `npx @celuneai/cli setup` again.

---

## 2. GitHub Integration

Connect your GitHub organization or personal account to enable repository access, PR tracking, and project linking across your workspace.

### How to Connect

1. Go to **Settings > Integrations** in the Celune dashboard.
2. Click **Add Account** under GitHub.
3. You will be redirected to GitHub to install the **Celune GitHub App**.
4. Select the organization or personal account you want to connect.
5. Choose which repositories to grant access to (all repos or select repos).
6. Authorize the installation and you will be redirected back to Celune.

### What You Get

- **Repository access** — browse and link repos to projects.
- **PR tracking** — see pull request status alongside your tasks.
- **Code review integration** — agents can provide context-aware code reviews.
- **Branch awareness** — view branches linked to active tasks.
- **File conflict detection** — get alerts when multiple tasks touch the same files.

### Managing Connections

- View connected accounts in **Settings > Integrations > GitHub**.
- Disconnect an account at any time — this revokes Celune's access to those repos.
- Only workspace owners can add or remove GitHub connections.

### Permissions Required

The Celune GitHub App requests read access to:

- Repository contents and metadata
- Pull requests and reviews
- Branches and commits

No write access to your code is required.

---

## 3. AI Provider Keys (BYOK)

Celune supports **Bring Your Own Key** — use your own AI provider API keys for agent conversations. This is optional; Celune provides default AI access on all plans.

### Supported Providers

| Provider          | Key Prefix | Default Model     |
| ----------------- | ---------- | ----------------- |
| **Anthropic**     | `sk-ant-`  | Claude Sonnet 4.6 |
| **OpenAI**        | `sk-`      | GPT-4o            |
| **Groq**          | `gsk_`     | Llama 3.1 70B     |
| **xAI (Grok)**    | `xai-`     | Grok-2            |
| **Google Gemini** | `AIza`     | Gemini 2.0 Flash  |
| **OpenRouter**    | `sk-or-`   | Auto              |

### How to Add a Key

1. Go to **Settings > Provider Keys**.
2. Click **Add Provider Key**.
3. Paste your API key.
4. Celune **auto-detects the provider** from the key prefix — no dropdown or manual selection needed.
5. The key is encrypted before storage and never displayed again in full.

### How It Works

- When an agent makes an AI call, Celune checks if you have a matching provider key.
- If found, your key is used instead of the platform default.
- Provider detection is instant — it matches the first few characters of your key against known prefixes.
- Keys are encrypted at rest using AES-256 and decrypted only at the moment of use.

### Managing Keys

- View key status (active, invalid, expired) in **Settings > Provider Keys**.
- Delete a key at any time to revert to the platform default.
- You can have one key per provider. Adding a new key for the same provider replaces the old one.

---

## 4. Slack Integration

Connect your Slack workspace to receive notifications from Celune directly in your team channels.

### How to Connect

1. Go to **Settings > Notifications**.
2. Click **Connect Slack**.
3. Authorize the Celune Slack app in your workspace.
4. Once connected, you can map event categories to specific Slack channels.

### Channel Mapping

After connecting, configure which channel receives each type of notification:

| Event Category   | Example Events                    | Suggested Channel      |
| ---------------- | --------------------------------- | ---------------------- |
| **Tasks**        | Task completed, assigned, blocked | `#general` or `#tasks` |
| **Code Reviews** | Review requested, completed       | `#code-reviews`        |
| **Alerts**       | System alerts, health issues      | `#alerts`              |
| **Billing**      | Invoice paid, usage thresholds    | `#billing`             |

### Slack Commands

The Celune Slack bot also supports slash commands for quick interactions directly from Slack. Type `/celune` in any channel to see available commands.

---

## 5. Webhooks

Webhooks let you send real-time event notifications from Celune to any external URL. Use them to trigger automations, update dashboards, or integrate with tools Celune does not natively support.

### Supported Events

| Event                     | Fires When                   |
| ------------------------- | ---------------------------- |
| `task.created`            | A new task is created        |
| `task.completed`          | A task is marked complete    |
| `task.updated`            | A task is modified           |
| `agent.status_changed`    | An agent goes online/offline |
| `usage.threshold_reached` | Usage hits a plan limit      |
| `billing.invoice_paid`    | A billing invoice is paid    |

### How to Create a Webhook

1. Go to **Settings > Webhooks**.
2. Click **Add Endpoint**.
3. Enter your endpoint URL (must be HTTPS).
4. Select which events to subscribe to (at least one required).
5. Optionally add a description.
6. Click **Create** — Celune generates a signing secret (`whsec_...`) for you.

### Verifying Webhook Signatures

Every webhook delivery includes an HMAC-SHA256 signature in the request headers. Use your signing secret to verify the payload has not been tampered with:

```javascript
import { createHmac } from 'crypto';

function verifySignature(payload, signature, secret) {
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  return expected === signature;
}
```

### Retry Behavior

If your endpoint returns a non-2xx status code, Celune retries the delivery up to **3 times** with increasing delays:

1. **Immediate** — first retry right away
2. **1 minute** — second retry
3. **5 minutes** — final retry

Each delivery attempt has a **10-second timeout**. If your endpoint consistently fails, the webhook is marked as unhealthy in the dashboard.

### Managing Webhooks

- View delivery history and status in **Settings > Webhooks**.
- Disable or delete endpoints at any time.
- Webhook management requires the `webhooks:read` and `webhooks:write` permissions.

---

## Plan Availability

| Integration        | Build (Free) | Pro | Team | Enterprise |
| ------------------ | :----------: | :-: | :--: | :--------: |
| IDE (MCP)          |     Yes      | Yes | Yes  |    Yes     |
| GitHub             |     Yes      | Yes | Yes  |    Yes     |
| BYOK Provider Keys |     Yes      | Yes | Yes  |    Yes     |
| Slack              |     Yes      | Yes | Yes  |    Yes     |
| Webhooks           |      --      | --  | Yes  |    Yes     |

---

## Next Steps

- [Getting Started](/docs/getting-started) — set up your workspace and first agent
- [Analytics & Support](/docs/analytics-and-support) — monitor usage and get help
