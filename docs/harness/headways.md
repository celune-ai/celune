# Headways reference harness

Headways is the first host for the harness contract in [README.md](./README.md). This note is the design for `packages/harness-headways` and `examples/headways` in the Celune repo (PRD R13 and R14, Technical Approach "Headways bridge"). No code in this note ships inside the Headways repo yet; a Headways-side PR is a separate follow-on.

Sprint 4 built v1 and proved it against a local Headways dev stack. v1 differs from the target design below in one way, recorded in [What v1 ships](#what-v1-ships-sprint-4): it adds no Headways API routes. The adapter drives Headways through its existing workspace API, and a run watcher in the sidecar polls run status. The bridge and in-transaction reporter remain the target for the Headways PR.

Headways paths below come from the Headways surface research (sections 2, 4, 6, 7). Line numbers there were current on the research date and need a re-check before the Headways PR.

## Shape

| Piece          | Where it runs                                                      | What it does                                                                                                   |
| -------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Celune sidecar | Beside the Headways dev stack (production placement decided later) | Runs `@celuneai/api` with the `HeadwaysHarness` adapter registered. Owns all task, project, and activity data. |
| Token mint     | Headways `apps/api`, `POST /v1/workspace/celune/token`             | Mints short-lived embed tokens for the UI and server tokens for agents.                                        |
| Celune UI      | Headways `apps/web` app shell                                      | `@celuneai/react` mounted on new routes, fed by a loader.                                                      |
| Run bridge     | Headways `apps/api`, `/v1/workspace/celune/runs*`                  | Turns a `startRun` call into an `AgentRun` inside a Workstream, answers heartbeat and cancel.                  |
| Event reporter | Headways `apps/api` and `apps/worker`                              | Posts run status changes to `POST /v1/harness/events` on the sidecar.                                          |
| Celune MCP     | Headways `apps/agent-runner`                                       | Registered as a remote MCP so agents can read tasks and comment.                                               |

Headways keeps no Celune tables in its Prisma schema. The only Headways-side state is the Celune workspace id in org settings and the idempotency keys the bridge already writes.

## Identity and tokens

Three credentials, each with one job.

1. **Embed token** (browser). The web loader calls the token mint after `requireActiveOrg`. The mint resolves the active org to its Celune workspace id from org settings and signs a JWT with `sub` = user id, `workspace_id`, `org_id`, `scopes` from the org role, `permissions` from the org role, and a 15 minute expiry. `mintHostJwt` in `@celuneai/api` produces this shape; Headways `apps/api` adds `jose`. Because it carries `permissions`, the sidecar refuses it on `/v1/mcp` and `/v1/harness/events`.
2. **Agent server token** (agent-runner). Minted by `apps/api` at run start with `sub` = the Celune agent id that claimed the task, `workspace_id`, `scopes: ['write']`, and no `permissions` claim. Expiry covers the run's maximum duration; the runner fetches a fresh one when it reconnects.
3. **Bridge API key** (server to server). One Celune API key with `write` scope per Headways environment, held in GCP Secret Manager and exposed through an ExternalSecret. The event reporter uses it.

Calls from the sidecar into the run bridge are signed with an HMAC over the body using a shared secret held on both sides, and the bridge checks the timestamp to refuse replays older than five minutes.

**Decision flagged:** the PRD sketch set the agent token `sub` to `agent:<run_id>`. This design uses the Celune agent id instead. With the agent id, a `claim_task` call from inside the run matches the active run on the task and starts nothing, and the task keeps its assignee. With `agent:<run_id>`, the same call would reassign the task to a per-run identity and log a delegation. The run id still reaches the agent through the system prompt.

## UI mount

- **Routes.** Add a route group in `apps/web/app/routes.ts` inside `routes/_app/_layout.tsx`: `tasks`, `projects`, `projects/:id`. The layout already applies `requireActiveOrg`, the workspace selector, `SidebarShell`, `GlobalTopBar`, and `BannerRegion`, and `<main>` stays the only scroll container.
- **Sidebar.** Add Tasks and Projects entries in `apps/web/app/components/sidebar.tsx` next to Workstreams, Routines, Knowledge Base, and Skills.
- **Loader.** Each route loader calls `requireActiveOrg(request)`, then the token mint server side, and returns `{ token, workspaceId, apiUrl }`. No client-side fetch to Headways `/v1` is added; the browser talks only to the Celune sidecar with the embed token.
- **Provider.** The route renders `CeluneProvider` with `apiUrl`, `token`, `workspaceId`, `refreshToken` (a server-side proxy route that calls the mint again), and `Link` from React Router. Theming uses the appearance contract: Headways passes its `@repo/ui` CSS variables so the module reads the same tokens in `:root` and `.dark`, and `pnpm audit:tokens` and `pnpm lint:design` stay green because no hex literals enter `apps/web`.

The UI is a React mount in the app shell. No iframe is used, so the prod-only CSP nonce issue recorded for `srcdoc` frames does not apply.

## Claim to AgentRun

1. An agent or a person claims a task mapped to a Headways agent. `HarnessService.claim` claims it through `TaskService` and calls `HeadwaysHarness.startRun`.
2. `startRun` posts to the bridge: `POST /v1/workspace/celune/runs` with the task view, the Celune agent id, and the harness agent id from the agent map. The harness agent id selects a Headways run profile (model, skills, connectors, `budgetUsdMax`).
3. The bridge resolves the org from the Celune workspace id, then finds or creates a Workstream for the task: `kind = user_initiated`, `goal` = task title plus description, owner = the org's configured Celune service user. The Workstream id is stored in the bridge's idempotency record keyed by task id, so a second run for the same task reuses the Workstream.
4. The bridge creates the `AgentRun` through the same code path as `POST /v1/workspace/workstreams/:workstreamId/runs`, with the task id, the agent server token reference, and reporting rules in `systemPromptAppend`. The run is enqueued on the DBOS `run-dispatch` queue as today.
5. The bridge answers `{ run_id, status: 'queued', url }`. Celune writes it to `metadata.harness_run` on the task and logs `harness.run.started`.
6. If the bridge fails, the task is blocked with `Harness start failed: <message>` and the claim still returns.

All bridge Prisma reads and writes filter by the resolved org id. Workstream and AgentRun use `orgId`; any older model touched uses `organizationId`.

## Run status to task status

`HeadwaysHarness` translates `AgentRun.status` onto the contract statuses and uses the default mapping.

| AgentRun status   | Reported where                               | Run status        | Task effect                                                                    |
| ----------------- | -------------------------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| `queued`          | run create, `/runs/:id/requeue`              | `queued`          | heartbeat                                                                      |
| `running`         | `/runs/:id/dispatch`                         | `running`         | `in_progress`, clears `action_state`                                           |
| `awaiting_input`  | `/runs/:id/park-awaiting`                    | `waiting`         | `action_state = open_question`                                                 |
| `completed`       | `/runs/:id/finalize-cost`                    | `succeeded`       | `review`, `outcome` = `narration` (the run DTO has no `narrationSummary`)      |
| `budget_exceeded` | `/runs/:id/finalize-cost`                    | `budget_exceeded` | stays `in_progress`, blocked, `action_state = run_failed`                      |
| `failed`          | `/runs/:id/fail`, `/sandboxes/:id/fail-runs` | `failed`          | stays `in_progress`, blocked with `failureReason`, `action_state = run_failed` |
| `cancelled`       | `POST /runs/:id/cancel`                      | `cancelled`       | back to `planning`, session ended                                              |

Success lands in `review` so a person checks agent work before `done`. This matches the R13 acceptance test.

**Event delivery.** Each of those endpoints writes its run change in a Prisma transaction today. After the transaction commits, the reporter enqueues a DBOS step that posts the event to the sidecar. DBOS retries the step with the same `event_id`, and the sidecar dedupes on it. Event ids are `<run_id>:<transition>`, for example `8f2c…:dispatch` or `8f2c…:finalize`; a requeue appends the attempt number. Cancels use `cancel:<run_id>`, the id `HarnessService.cancel` uses, so a cancel that starts in Celune and comes back through the reporter is applied once. `occurred_at` is the time of the Prisma write, so a late retry that arrives after a newer event is recorded as stale.

`progress` carries `tokens` and `costUsd` from the run so the board can show spend.

## Heartbeat

Events cover every status change, so the board stays current without polling. `HeadwaysHarness.heartbeat` exists for runs that go quiet: it calls `GET /v1/workspace/celune/runs/:id` on the bridge, which reads `AgentRun.status` under the org filter. A scheduled Celune job calls `HarnessService.heartbeat` for tasks whose run has had no event for 15 minutes. The event id for a pulled state is `heartbeat:<run_id>:<timestamp>`.

Agent status in Celune follows from the events: non-terminal events set the claiming agent to `working` on the task, terminal events set it `online` with no current task. Pod heartbeats (`/pods/:id/heartbeat`) are infrastructure signals and are not mapped to tasks.

## Cancel

A cancel from Celune calls `HarnessService.cancel`, which calls `HeadwaysHarness.cancelRun`. The bridge runs the same code as `POST /runs/:id/cancel`, which then reports `cancelled` through the normal event path with event id `cancel:<run_id>`. The sidecar already applied that id and answers `duplicate: true`. A cancel from inside Headways goes straight to the event path.

## Agent tools through MCP

The Celune MCP server registers in Headways as a `remote_mcp` connector with key `celune`. At session start, `apps/agent-runner/src/remote-mcp.ts` fetches the bearer for that connector (the agent server token) and mounts it as `mcp__celune`.

The capability manifest tells the agent the task id and to use `get_task`, `list_tasks`, `add_comment`, and `create_task` for follow-ups. It tells the agent not to call `complete_task` or `block_task` on its own task, because the run finalize reports status and a `complete_task` followed by a `succeeded` event would move the task from `done` back to `review`. Tool-level filtering for harness agents is a follow-up in `@celuneai/api`.

## Egress

- **Runner to Celune.** Every MCP call from the agent-runner goes through the egress gateway `forward()` in `apps/egress-gateway/src/forward.ts`, which resolves the principal and the `celune` connection and checks `status`, `custodyStatus`, `secretRef`, and policy before the upstream call. The agent server token is the connection secret.
- **Reporter to Celune.** Event posts from `apps/api` and `apps/worker` also go through `forward()` using a service connection whose secret is the bridge API key, so one policy covers all Headways traffic to Celune. Whether `forward()` accepts a service principal with no run today is an open question.
- **Celune to Headways.** `startRun`, heartbeat, and cancel are inbound to Headways `apps/api` and use the HMAC check above.

## Prisma Store alternative (deferred)

`@celuneai/core` talks to data through the `Store` interface, so a Prisma-backed Store inside Headways is possible: Celune tables in the Headways schema, tasks written in the same transaction as the AgentRun, and no sidecar. It is deferred for these reasons.

1. **Schema ownership.** Every change to `packages/db/prisma/schema.prisma` and its migrations needs review from the schema code owner. Celune's tables and every later change to them would wait on Headways review, which ties the Celune release cadence to it.
2. **Interface stability.** The `Store` interface is still changing during the open-source sprints. A second production implementation now would add a Prisma change to every interface change.
3. **Build constraints.** `apps/api` ships as a tsup bundle, so a source-only Celune package needs a `noExternal` entry, and web and api must produce identical Prisma writes without cross-app imports.
4. **Open-source reach.** The sidecar shape works for any host with an HTTP stack. The Prisma Store only helps Prisma hosts.

What the sidecar gives up is the single transaction across task and run. The event path covers it: the DBOS step retries until the sidecar accepts, the sidecar dedupes on event id, and stale ordering is detected. Revisit the Prisma Store once the `Store` interface holds steady for a release and Headways decides where production Celune runs.

## Constraints checklist

- Every bridge query filters by the org resolved from the Celune workspace id.
- Bridge tests in the Headways monorepo copy the `headways_test` database guard.
- Design token lint and the precommit hook pass with the UI mount.
- Headways-side changes stay additive: routes, sidebar entries, loaders, the token mint, the run bridge, the reporter hooks, and one connector row.

## What v1 ships (Sprint 4)

| Piece                 | Package or file                                     | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HeadwaysHarness`     | `packages/harness-headways/src/harness.ts`          | `startRun` creates a Workstream (`goal` = title plus description), a group thread, a brief message with `mentionsAgent: false`, and an AgentRun through `POST /v1/workspace/workstreams/:id/runs` with the profile's model and `budgetUsdMax` and the brief as `triggeringMessageId`. `clientRequestId` values are keyed by task id, and the adapter reuses a task's Workstream for later runs. `heartbeat` reads `GET /v1/workspace/runs/:id` (404 before the worker writes the row reads as `queued`). `cancelRun` calls `POST /v1/workspace/runs/:id/cancel`.                                                                                                                                                                                                                                                                                                                                                |
| `HeadwaysRunWatcher`  | `src/watcher.ts`                                    | Polls tracked runs and posts each status change to `/v1/harness/events` with event id `<run_id>:<transition>` (`queue`, `dispatch`, `park-awaiting`, `finalize`, `fail`) and `cancel:<run_id>`. A repeated transition gets `:<n>`; a terminal event never does. Non-terminal events use the observation time; terminal events use `endedAt` unless it is older than the last report. `outcome` is `narration`, because the run DTO has no `narrationSummary`. On `start()` and every `resyncMs` (default 60 s) it rebuilds the tracked set from `GET /v1/harness/runs?harness=headways`, resuming from the status and event ids Celune last applied, so a sidecar restart keeps reporting. A run that ended while no watcher ran is reported once at resync. A resumed run is read with the key of the user it was started as, from `harness_run.run_as`; runs started with the org owner key have no `run_as`. |
| `CeluneEventReporter` | `src/reporter.ts`                                   | Signs a server JWT (write scope, no `permissions`) and refreshes it before expiry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| MCP connector         | `src/mcp-connector.ts`                              | `celuneMcpConnector()` returns the `remote_mcp` catalog row; `mintAgentServerToken()` signs the runner bearer with `sub` = Celune agent id.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Agent map             | `src/config.ts`, `examples/headways/agent-map.json` | Celune agent id to harness agent id to run profile, from env or a JSON file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Sidecar               | `examples/headways/sidecar/server.ts`               | `apps/api` `buildServer` with the harness registered, an origin allowlist for browser calls, and the watcher.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| UI                    | `examples/headways/headways/`                       | Pages, token route, mount component, CSS mapping, and patches. See `examples/headways/README.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Decisions taken for v1 (lead decisions file, 2026-09-27):

1. **Workstream owner.** The Headways user whose API key the adapter holds. The sidecar resolves the claiming Celune user's email and uses that user's key when `HEADWAYS_USER_KEYS` has it; otherwise the org owner's key. Adding watchers as `WorkstreamCollaborator` rows is not done yet.
2. **Egress.** The watcher runs in the sidecar and calls Celune directly with a server JWT. The runner's Celune MCP traffic goes through the egress gateway as a remote MCP connector.
3. **Agent map.** Adapter config (env or JSON file) for v1.
4. **Routines.** A routine creates Celune tasks through the MCP `create_task` tool, packaged as a Headways skill; no Headways code. The skill bodies are `celune-task` and `celune-project-plan`, which `npx @celuneai/cli connect` installs or prints the path to (see [connect.md](./connect.md#host-runtime-skills)).

## Proof (Sprint 4)

Run on 2026-09-27 against a native Headways stack (Postgres, in-memory SpiceDB, api, web, worker; no Docker) on a local branch, and a Celune sidecar on a throwaway Supabase project created by `celune init --mode supabase`. The log and screenshots are kept with the sprint report.

Proven end to end:

1. A Celune task claimed by agent `rick` created a Workstream in the mapped Headways org with the task as goal, a brief message, and an AgentRun row written by the Headways worker (`queued`, model and budget from the profile).
2. The run moved to `running`; the watcher reported it and the task stayed `in_progress` with `harness_run.status = running`. The task drawer timeline showed `headways run started` and `headways run running`, and the Headways workstream page showed the brief with the run marked Working.
3. `finalize-cost` with `completed` moved the task to `review` with the narration as `outcome`.
4. A second task whose run ended `budget_exceeded` stayed `in_progress`, blocked with `Run stopped: budget exceeded`, `action_state = run_failed`.
5. A replayed event returned `duplicate: true`; an embed token was refused on `/v1/harness/events`; an agent server token listed 19 MCP tools and read the task with `get_task`.
6. The Tasks, Projects, and project pages rendered inside the Headways app shell in light and dark through `mappings/headways.css`. `pnpm audit:tokens` passed with 0 errors and 0 warnings, and `pnpm lint:design` passed with 0 errors.

Stubbed:

- **Agent execution.** No sandbox pod runs locally, so the worker leaves runs `queued` (no pod capacity). A runner stub wrote `running` with SQL (the worker's `claimQueuedRun`), wrote the narration with SQL (the `end-turn` accounting write), and called the real control-plane route `POST /internal/workspace/runs/:id/finalize-cost` for both terminal states. `/runs/:id/dispatch`, `end-turn`, and the agent's own MCP calls from inside a sandbox were not exercised.
- **Connector credential.** The `celune` connector row and the agent token were checked against `/v1/mcp` directly; they were not stored in Headways, which has no route that saves an api-key credential for a remote MCP connector.

Bugs found and fixed:

- `HarnessService` wrote heartbeat rows with `event_type = 'harness.<status>'`, which the `heartbeat_events_event_type_check` constraint rejects, so every non-terminal event returned 500 on Postgres. It now writes `working` with the run status in `metadata.harness_status`, and the in-memory store enforces the same set.
- The watcher first reused `startedAt` for a second `running` after a park, which Celune marked stale. Non-terminal events now use the observation time.

## Gaps

1. **Polling instead of push.** The watcher still polls every few seconds. A sidecar restart no longer drops runs: the watcher resyncs its tracked set from Celune on start and every minute (fixed after the proof, see "Fixed after the proof"). Status still lags by up to one poll interval, and a park and resume that both happen between two polls is not reported. The in-transaction reporter in Headways (DBOS step after each run write) is the fix and belongs in the Headways PR.
2. **Connector credential storage.** Headways needs a way to hold the agent server token for the `celune` connector per run, minted at dispatch.
3. **`@celuneai/react` ships TypeScript source.** Under Headways' `noUncheckedIndexedAccess`, `apps/web` type-check reports 19 errors inside `packages/react/src` and `packages/types/src` (0 in the Headways files). Publishing needs built `.d.ts` files or source that passes stricter settings.
4. **Local link needs Vite config.** Linking a checkout requires `server.fs.allow` and SSR `noExternal` for the module's React dependencies (`patches/vite-local-link.patch`). A published package should not.
5. **Run state in the UI.** The drawer shows harness events in the timeline, but no run panel with a link to the Workstream, and a card blocked by `run_failed` has no badge on the board.
6. **Embed token `sub`.** The embed token carries the Headways user id. Viewing and moving tasks worked; attribution of UI writes to a Celune user is not mapped yet.
7. **Workstream collaborators and assigner lookup.** Owner selection uses the claiming user; the task's assigner and watchers are not read yet.
8. **Workstream map after a restart.** The run's owner is stored on `harness_run.run_as` (the email whose key started it), so a resumed run is read and cancelled with that user's key; Headways refuses the org owner key with 403 `not a collaborator` on another user's Workstream. The task-to-Workstream map is still in memory, so a task's second run after a restart creates a new Workstream. That needs the Workstream id stored on `harness_run`.

### Fixed after the proof

- **Watcher resume.** `HeadwaysRunWatcher.resync()` rebuilds the tracked set from `GET /v1/harness/runs` (`HarnessService.activeRuns`, a workspace-scoped task query on `metadata.harness_run`). Repeat counters continue from the event ids Celune applied, and terminal event ids carry no counter, so a completion found at resync is applied once.
- **API error mapping.** PostgREST returns plain error objects, and Hono only passes `Error` instances to `onError`, so a store failure became an empty 500 with no log line. `SupabaseStore` now throws `StoreError` (message and Postgres code), and `@celuneai/api` catches any thrown value in its first middleware. Unexpected errors are logged with the request id, route, and error name, code, and message (no bodies, headers, or stacks) and answered with `{ "error": "internal_error", "request_id": "..." }`. Every response carries `x-request-id`; a caller's plain id is kept. Typed Celune errors keep their status and code. The platform `/api/v1` route and `apps/api` both serve `createApi`, so both use this handler.

## Onboarding with `celune connect`

`npx @celuneai/cli connect` run on a Headways-shaped repo reads it as a Claude Agent SDK host: run primitive `Workstream + AgentRun`, schedule primitive `Routine`, DBOS as the dispatcher, Prisma, React Router and Hono, and the `requireActiveOrg` guard. It scaffolds from the `sdk-workstream` template, which follows `HeadwaysHarness`. The CLI test fixture `packages/cli/test-fixtures/connect/headways` holds the minimal shape it matches. See [connect.md](./connect.md).

## Related

- [README.md](./README.md)
- [connect.md](./connect.md)
