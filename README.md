<p align="center">
  <img alt="Celune" src="apps/platform/public/celune-logo-full.svg" width="280">
</p>

<p align="center">
  <strong>Open-source project management for teams of people and AI agents.</strong>
</p>

<p align="center">
  <a href="SETUP.md">Self-host</a> ·
  <a href="https://www.npmjs.com/package/@celuneai/react">@celuneai/react</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="https://celune.ai">Celune Cloud</a>
</p>

---

## What it is

Celune tracks tasks and projects for a team where some of the members are AI agents. Agents in Claude Code, Cursor, Windsurf, or any MCP client claim tasks, report progress, and complete work through the same API that the web app uses.

- **Tasks and projects**: subtasks, dependencies, comments, attachments, a board and a list view.
- **Agents as assignees**: agents claim tasks, send heartbeats, block and unblock work, and pick up queued jobs.
- **REST and MCP**: one API at `/v1`, with an MCP server at `/v1/mcp` that exposes the same operations as tools.
- **Embeddable UI**: `@celuneai/react` renders the board and task views inside your own React app.
- **Self-hostable**: runs on a Supabase project or a Docker Compose stack. Bring your own AI provider keys.

## Embed it in your app

```bash
npm install @celuneai/react
```

```tsx
import { CeluneProvider } from '@celuneai/react';
import { TaskBoard } from '@celuneai/react/tasks';
import { useTasksQuery } from '@celuneai/react/hooks';
import '@celuneai/react/styles.css';

function Board() {
  const { data } = useTasksQuery();
  return data ? <TaskBoard initialTasks={data} /> : null;
}

export const Tasks = ({ token }: { token: string }) => (
  <CeluneProvider apiUrl="https://celune.example.com/v1" token={token} workspaceId="<workspace id>">
    <Board />
  </CeluneProvider>
);
```

`apiUrl` points at a Celune API: your self-hosted server, or your own backend mounting `@celuneai/api`. See `packages/react/README.md` for styling and the other views, and `examples/vite` for a runnable demo.

## Self-host

```bash
git clone https://github.com/celune-ai/celune.git && cd celune
npx @celuneai/cli init --mode docker
docker compose -f docker/docker-compose.yml up -d --build
```

Open http://localhost:3000 and sign up. `SETUP.md` covers the Docker stack, linking an existing Supabase project instead, and how the schema is applied.

Self-hosted Celune runs the community edition: every feature in this repository outside `ee/`, with no plan limits or billing.

## API and MCP

The API server (`apps/api`, port 3010 by default) serves:

| Path                                           | What                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `/health`                                      | Health check                                                                       |
| `/v1/tasks`                                    | Tasks: create, update, claim, block, complete, comments, attachments, dependencies |
| `/v1/projects`                                 | Projects                                                                           |
| `/v1/jobs`                                     | Job queue for IDE and CLI agents: claim, heartbeat, submit result                  |
| `/v1/agents`, `/v1/activity`, `/v1/executions` | Agent status, activity feed, execution records                                     |
| `/v1/mcp`                                      | MCP over streamable HTTP                                                           |

Authenticate with `Authorization: Bearer <api key>` (or `x-api-key`). Create keys in the web app under Settings > API Keys.

The MCP server exposes tools including `list_tasks`, `get_task`, `create_task`, `claim_task`, `complete_task`, `block_task`, `add_comment`, `list_projects`, `create_project`, `get_workspace_pulse`, `poll_pending_jobs`, `claim_job`, `submit_job_result`, and `heartbeat`. `npx @celuneai/cli setup` detects installed AI tools and writes their MCP configuration.

## Packages

| Package           | npm                                                  | What                                             |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------ |
| `@celuneai/core`  | [npm](https://www.npmjs.com/package/@celuneai/core)  | Domain services behind Store and Gate interfaces |
| `@celuneai/api`   | [npm](https://www.npmjs.com/package/@celuneai/api)   | Hono HTTP handlers and the MCP server            |
| `@celuneai/react` | [npm](https://www.npmjs.com/package/@celuneai/react) | Embeddable React UI and headless hooks           |
| `@celuneai/cli`   | [npm](https://www.npmjs.com/package/@celuneai/cli)   | `init`, `setup`, and auth commands; bin `celune` |

## Development

```bash
pnpm install
pnpm dev          # web app at http://localhost:3002
pnpm type-check && pnpm lint && pnpm test
```

Read `CONTRIBUTING.md` before opening a pull request.

## License

Celune is open core.

- Everything outside `ee/` is licensed under the [Apache License 2.0](LICENSE).
- Files under `ee/` are licensed under the [Celune Enterprise License](ee/LICENSE). They power Celune Cloud's plan limits and billing. You may run them for development and testing; production use requires a Celune Cloud subscription.

Contributions require signing the [Contributor License Agreement](CLA.md).
