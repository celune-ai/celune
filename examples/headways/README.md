# Celune in Headways (reference embed)

This example mounts the Celune tasks and projects module inside the Headways web app shell and runs Celune tasks as Headways AgentRuns. It was applied to a local Headways checkout and proven end to end; see `docs/harness/headways.md` for what was proven and what was stubbed.

It has two parts:

- **`headways/`**: files to copy into a Headways checkout at the same paths, plus patches for the two files that change.
- **`sidecar/`**: the Celune API with the Headways harness registered. It runs beside the Headways stack.

## How the pieces talk

| From                   | To                                  | Credential                                                                                                                                                        |
| ---------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headways web (browser) | Celune sidecar `/v1`                | Embed JWT minted by the page loader: `sub` = Headways user id, `workspace_id`, `org_id`, scopes and `permissions` from the org role, 15 minute expiry             |
| Celune sidecar         | Headways API `/v1/workspace/*`      | Headways API key of the assigner to start a run (the run is refused without one); the same key, found from `harness_run.run_as`, for runs resumed after a restart |
| Sidecar run watcher    | Celune sidecar `/v1/harness/events` | Server JWT: write scope, no `permissions` claim                                                                                                                   |
| Headways agent-runner  | Celune `/v1/mcp`                    | Server JWT with `sub` = Celune agent id (`mintAgentServerToken`)                                                                                                  |

## 1. Run the sidecar

From the Celune repo, after `npx @celuneai/cli init --mode supabase` wrote `apps/api/.env`:

```bash
cd examples/headways
node --env-file=../../apps/api/.env --env-file=.env sidecar/server.ts
```

`examples/headways/.env` (not committed) holds:

| Variable                                | Meaning                                                                                                                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CELUNE_WORKSPACE_ID`, `CELUNE_ORG_ID`  | The Celune workspace this Headways org maps to                                                                                                                                     |
| `CELUNE_REPORTER_USER_ID`               | Celune user id the run watcher reports as                                                                                                                                          |
| `CELUNE_HEADWAYS_AGENT_MAP_FILE`        | Path to an agent map such as `agent-map.json` (or inline JSON in `CELUNE_HEADWAYS_AGENT_MAP`)                                                                                      |
| `HEADWAYS_API_URL`, `HEADWAYS_WEB_URL`  | Headways API origin, and the web base used for run links (`https://app.example.com/o/<slug>`)                                                                                      |
| `HEADWAYS_ORG_SLUG`, `HEADWAYS_API_KEY` | Org slug and the org owner's Headways API key                                                                                                                                      |
| `HEADWAYS_USER_KEYS`                    | JSON map of email to Headways API key. A run starts only for an assigner listed here, and is owned by them                                                                         |
| `CELUNE_CORS_ORIGINS`                   | Comma-separated web origins allowed to call the sidecar from the browser                                                                                                           |
| `HEADWAYS_WATCH_INTERVAL_MS`            | How often the watcher polls active runs (default 3000)                                                                                                                             |
| `HOST`, `PORT`                          | Address the sidecar listens on (default `127.0.0.1:3010`). Set `HOST=0.0.0.0` only behind a proxy                                                                                  |
| `CELUNE_SELF_URL`                       | Origin the run watcher posts events to (default `http://localhost:<PORT>`). Set it when the sidecar cannot reach itself on localhost, for example behind a proxy or in a container |

`agent-map.json` maps Celune agent ids to Headways run profiles:

```json
{
  "agents": { "rick": "headways-builder" },
  "profiles": { "headways-builder": { "model": "claude-sonnet-4-6", "budgetUsdMax": 2 } }
}
```

A claim by `rick` then creates a Workstream whose goal is the task, a group thread holding the task brief, and an AgentRun triggered by that brief. The watcher reports the run's status changes to Celune; a completed run moves the task to `review` with the run narration as its outcome.

## 2. Apply the Headways files

From the Headways repo root:

```bash
CELUNE=/path/to/celune
cp -R "$CELUNE/examples/headways/headways/apps/web/." apps/web/
git apply "$CELUNE/examples/headways/headways/patches/routes.patch"
git apply "$CELUNE/examples/headways/headways/patches/sidebar.patch"
pnpm --filter @headways/web add @celuneai/react
```

What lands:

- `app/routes/celune.tasks.tsx`, `celune.projects.tsx`, `celune.projects.$id.tsx`: pages inside `routes/_app/_layout.tsx` at `/o/:orgSlug/tasks`, `/projects`, `/projects/:id`. Each loader calls `requireActiveOrg` through `loadCeluneEmbed`.
- `app/routes/api.celune.token.tsx`: `POST /api/celune/token?org=<slug>` mints a fresh embed token for `refreshToken`.
- `server/celune.server.ts`: org to workspace lookup and the HS256 mint (`node:crypto`, no new dependency).
- `app/components/celune-mount.tsx`: `CeluneProvider` with the React Router `Link`, org-scoped `href`, and the current user.
- `app/celune.css`: imports `@celuneai/react/components.css` and `@celuneai/react/mappings/headways.css`. No color literals, so `pnpm audit:tokens` stays green.
- Patches: the three routes plus `api/celune/token` in `app/routes.ts`, and Tasks and Projects in the sidebar next to Workstreams.

Headways web env:

| Variable                 | Meaning                                                                  |
| ------------------------ | ------------------------------------------------------------------------ |
| `CELUNE_API_URL`         | Browser-reachable sidecar base, for example `https://celune.internal/v1` |
| `CELUNE_HOST_JWT_SECRET` | Same value as the sidecar's `CELUNE_HOST_JWT_SECRET`, 32 bytes or more   |
| `CELUNE_WORKSPACES`      | JSON map of Headways org slug to Celune workspace id                     |

Orgs missing from `CELUNE_WORKSPACES` see an empty state on both pages.

### Local link instead of a published package

Until `@celuneai/react` is on npm, link a Celune checkout and apply `patches/vite-local-link.patch`. It lets Vite serve files from the linked path and bundles the module's React-bound dependencies in SSR so they share Headways' React. Set `CELUNE_LINKED_PATH` to the Celune checkout. The patch does nothing when that variable is unset.

```bash
pnpm --filter @headways/web add "@celuneai/react@link:$CELUNE/packages/react"
pnpm --filter @celuneai/react build   # in the Celune repo; produces dist/components.css
git apply "$CELUNE/examples/headways/headways/patches/vite-local-link.patch"
```

## 3. Give agents the Celune tools

Register Celune as a remote MCP connector in the Headways catalog. `celuneMcpConnector({ celuneApiUrl })` from `@celuneai/harness-headways` returns the seed row (`key: 'celune'`, `integrationType: 'remote_mcp'`, `authType: 'api-key'`, URL `<celune>/v1/mcp`). The runner's bearer for that connector is `mintAgentServerToken({ agentId, workspaceId }, { secret })`. Headways has no API route today that stores an api-key credential for a remote MCP connector, so that step is manual; see the gaps in `docs/harness/headways.md`.

## Routines

A Headways routine creates Celune tasks by calling the Celune MCP `create_task` tool from a skill, so recurring work lands on the board with no new Headways code.
