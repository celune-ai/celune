# Harness adapter contract

A harness is the runtime that executes agent work in a host product: a sandboxed SDK session, a job worker, a CI runner. The harness contract lets Celune hand a claimed task to that runtime and lets the runtime report back, so the task board shows what the agent is doing without the host writing task logic.

The contract lives in `@celuneai/core` under `src/harness/`. The inbound endpoint lives in `@celuneai/api`. Headways is the reference host; see [headways.md](./headways.md). To onboard a host, start with [connect.md](./connect.md).

## Parts

| Part                      | Package | Role                                                               |
| ------------------------- | ------- | ------------------------------------------------------------------ |
| `HarnessAdapter`          | core    | The interface a host implements.                                   |
| `HarnessRegistry`         | core    | Holds one adapter per workspace plus the agent map.                |
| `HarnessService`          | core    | Starts runs on claim and applies run events through `TaskService`. |
| `defaultRunEventMapping`  | core    | The standard mapping from run status to task effect.               |
| `LoopbackHarness`         | core    | In-process adapter for tests and local development.                |
| `POST /v1/harness/events` | api     | Where a host reports run status.                                   |

## The adapter

```ts
interface HarnessAdapter {
  capabilities(): HarnessCapabilities; // name, version, cancel, heartbeat, budgets
  startRun(task: HarnessTaskInput, context: HarnessRunContext): Promise<StartRunResult>;
  onRunEvent(event: HarnessRunEvent): HarnessEffect; // pure mapping, no I/O
  heartbeat(runRef: HarnessRunRef): Promise<HarnessHeartbeat>;
  cancelRun(runRef: HarnessRunRef): Promise<void>;
}
```

- **`startRun`** is the one outbound call a claim makes. It receives a narrow task view (id, title, description, priority, project id, workspace id, org id) and the harness agent id from the agent map. It returns the host's run id.
- **`onRunEvent`** maps an inbound event to a `HarnessEffect`. Most adapters return `defaultRunEventMapping(event)`. A host that wants success to land in `done` passes `{ completeTo: 'done' }`.
- **`heartbeat`** pulls the current run state. `HarnessService.heartbeat` turns the answer into an event and applies it. Hosts that push events can report `heartbeat: false` in capabilities.
- **`cancelRun`** stops a run. `HarnessService.cancel` calls it, then applies a `cancelled` event.

## Run statuses and the default mapping

Harness run statuses are fixed: `queued`, `running`, `waiting`, `succeeded`, `failed`, `cancelled`, `budget_exceeded`, `timed_out`. An adapter translates host statuses into these.

| Run status        | Task status                            | Other effects                                                   |
| ----------------- | -------------------------------------- | --------------------------------------------------------------- |
| `queued`          | unchanged                              | agent heartbeat                                                 |
| `running`         | `in_progress`                          | heartbeat; lifts a block the harness set; clears `action_state` |
| `waiting`         | unchanged                              | heartbeat; `action_state = open_question`                       |
| `succeeded`       | `review` (or `done` with `completeTo`) | writes `outcome`; clears `action_state`                         |
| `failed`          | unchanged                              | blocks with the error; `action_state = run_failed`              |
| `timed_out`       | unchanged                              | blocks; `action_state = run_failed`                             |
| `budget_exceeded` | unchanged                              | blocks; `action_state = run_failed`                             |
| `cancelled`       | `planning`                             | ends the active session; clears `action_state`                  |

Every status change goes through `TaskService.updateStatus` or `TaskService.complete`, so the transition validator applies. An event that asks for a move the validator refuses (for example `succeeded` on a task still in `inbox`) fails with 409 and changes nothing.

Blocks the harness sets carry `blocked_by = harness:<name>`. A later `running` event lifts only those. A block a person set stays.

## Claim flow

1. An agent claims a task through the REST claim route or the `claim_task` MCP tool. Both call `HarnessService.claim`.
2. `TaskService.claim` runs as before: blocked tasks refuse, fresh tasks walk through `planning`, the task lands in `in_progress`.
3. If the workspace has an adapter and the claiming agent is in its agent map, the service calls `startRun`. Unmapped agents get a plain claim.
4. The run is recorded on the task at `metadata.harness_run` (`harness`, `run_id`, `harness_agent`, `status`, `started_at`, `url`, recent `event_ids`), and a `harness.run.started` activity row is written.
5. If a run for the task is still active, a second claim returns that run and starts nothing. This covers an agent claiming its own task over MCP from inside the run.
6. If `startRun` throws, the task is blocked with `Harness start failed: <message>` and the claim response still returns the task.

## Reporting run events

```http
POST /v1/harness/events
Authorization: Bearer <server JWT or API key>
Content-Type: application/json

{
  "event_id": "run-8f2c:finalize",
  "task_id": "3f1e…",
  "harness": "headways",
  "run_id": "8f2c…",
  "status": "succeeded",
  "occurred_at": "2026-09-27T18:04:11Z",
  "outcome": "Opened PR 1102 with the migration and tests.",
  "error": null,
  "progress": { "cost_usd": 0.42 }
}
```

Response:

```json
{
  "applied": true,
  "duplicate": false,
  "stale": false,
  "task_id": "3f1e…",
  "task_status": "review",
  "run_status": "succeeded"
}
```

| Case                                                            | Status |
| --------------------------------------------------------------- | ------ |
| Applied, duplicate, or stale                                    | 200    |
| Bad body or unknown status                                      | 400    |
| Event for a different active run or a different harness         | 400    |
| No token                                                        | 401    |
| Read-only key, or an embed JWT (one with a `permissions` claim) | 403    |
| Task not in the token's workspace                               | 404    |
| Transition refused by the validator                             | 409    |

**Credentials.** Use an API key with `write` scope or a server JWT minted without a `permissions` claim. Embed tokens carry `permissions` and are refused, because they live in a browser.

**Idempotency.** `event_id` is the key. The service takes the id in an atomic ledger before applying and releases it if the apply fails, so a retry after a 409 or 500 runs again. The last 50 applied ids also live on the task, so a replay after a restart is still a duplicate. Hosts with several API replicas pass a shared `harnessLedger` (for example a table with a unique index on workspace id and event id) to `createServices`.

**Ordering.** An event older than the last applied one for the same run is recorded as `stale` and changes nothing. A non-terminal event after a terminal one is also stale. A new `run_id` is accepted once the previous run has ended; this is how a host retries.

**Hosts without an adapter.** If no adapter is registered for the workspace, events still apply with the default mapping. A host that starts runs on its own can report them without writing an adapter.

## Registering an adapter

```ts
import { createServices, HarnessRegistry } from '@celuneai/core';

const harnessRegistry = new HarnessRegistry();
harnessRegistry.register(workspaceId, new MyHarness(config), {
  agents: { rick: 'agent-7', scan: 'agent-9' }, // Celune agent id to harness agent id
});
const services = createServices(store, { harnessRegistry });
```

An adapter registered in code lives in memory, one per workspace; `register` refuses a second one unless `replace: true`.

### Stored connections

To keep a workspace's registration across restarts, give the registry a factory for the harness and store the connection. The `harness_connections` table holds the harness name, the agent map, and the adapter config. The config must not hold credentials: the service refuses keys such as `apiKey`, `token`, or `secret`. The factory reads credentials from the host environment or from the encrypted provider key storage.

```ts
const harnessRegistry = new HarnessRegistry({
  factories: {
    myharness: (config) => new MyHarness({ ...config, apiKey: process.env.MY_HARNESS_KEY! }),
  },
});
const services = createServices(store, { harnessRegistry });
await services.harness.connect(
  scope,
  { harness: 'myharness', agents: { rick: 'agent-7' }, config: { baseUrl: 'https://h.example' } },
  actor,
);
```

The same operation is available at `PUT /v1/harness/connection` (with `GET` and `DELETE`), which needs an `admin` scope key or a server token. Embed tokens are refused. An adapter registered in code takes precedence over a stored connection for the same workspace.

## Onboarding a new host

`npx @celuneai/cli connect` automates steps 3 to 7: it detects the run and schedule primitives, scaffolds the adapter, config, and env example, installs the Celune skills for the host agents, and `--check` verifies the event credential. See [connect.md](./connect.md). The steps below are what it automates and what stays manual.

1. **Place Celune.** Run a Celune instance beside the host (self-hosted) or use Cloud, and create the workspace the host org maps to.
2. **Credentials.** Configure `CELUNE_HOST_JWT_SECRET` or `CELUNE_HOST_JWKS_URL` so the host can mint tokens. To pin tokens to one issuer and audience, set `CELUNE_HOST_JWT_ISSUER` and `CELUNE_HOST_JWT_AUDIENCE`; the Celune web app signs embed tokens with them and the API checks them, so set the same values on both (the Docker stack passes one pair from `docker/.env` to the api and web services), and have the host mint its tokens with the same `iss` and `aud`. Create one API key with `write` scope for server-to-server event reports and store it in the host's secret manager.
3. **Find the run primitive.** Identify the host object that executes agent work, its status enum, where it becomes terminal, and how to create one. Also identify the schedule primitive (a routine or cron) for tasks that recur.
4. **Write the adapter.** Implement `HarnessAdapter`. Map host statuses onto the eight run statuses. `startRun` creates the host run with the task as goal context. Start from `LoopbackHarness` as a template.
5. **Map agents.** Decide which Celune agents run in this harness and register the agent map.
6. **Report events.** At every point where the host run changes state, post to `/v1/harness/events` with a stable `event_id`.
7. **Give agents tools.** Register the Celune MCP server (`/v1/mcp`) in the host runtime with a server JWT whose `sub` is the Celune agent id.
8. **Mount the UI.** Mount `CeluneProvider` from `@celuneai/react` in the host app shell with a host-minted embed token.
9. **Verify.** Claim a task as a mapped agent and confirm a run starts; send `running` then `succeeded` and confirm the task reaches `review`; send `budget_exceeded` and confirm it stays `in_progress` with `action_state = run_failed`; replay an event and confirm `duplicate: true`.
