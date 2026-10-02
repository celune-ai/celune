# Connect a harness: `celune connect`

`npx @celuneai/cli connect` onboards a host product that runs its own agents. It reads the host repository, names the parts Celune plugs into, writes a starting `HarnessAdapter` and config, installs three skills for the host's agents, and checks that the host can report run events. It automates steps 3 to 7 and part of step 9 of [Onboarding a new host](./README.md#onboarding-a-new-host).

Run it from the host repository root, or pass the path:

```bash
npx @celuneai/cli connect              # detect and print the plan (dry run)
npx @celuneai/cli connect --write      # write the planned files
npx @celuneai/cli connect --check      # post a test event with the configured credential
```

Always invoke it as `npx @celuneai/cli`. The unscoped `celune` package on npm is unrelated.

## What it detects

The scan is read-only. Inside a git work tree the file list comes from `git ls-files`, so `.gitignore` applies exactly; outside one, the root `.gitignore` is applied by a small matcher. `node_modules`, build output (`dist`, `build`, `.next`, `out`, `coverage`, and similar), virtual environments, and test fixture directories are always skipped. Files over 256 KB are not read.

Each known harness shape gets a score from 0 to 1. The best shape at 0.45 or above is used.

| Shape                 | Signals                                                                                                                                                                                                                           | Template         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Claude Agent SDK host | `@anthropic-ai/claude-agent-sdk` or `claude_agent_sdk`, `query()` or `ClaudeSDKClient` calls, Prisma run models (`AgentRun`, `Run`), container models (`Workstream`), a dispatcher queue, schedule models (`Routine`, `Schedule`) | `sdk-workstream` |
| Job queue             | BullMQ, DBOS, Temporal, Inngest, or pg-boss: the dependency, imports, worker or workflow definitions, repeatable or cron schedules                                                                                                | `queue`          |
| HTTP task runner      | `POST` or `PUT` routes on `tasks`, `jobs`, or `runs` (Express, Hono, Fastify, Next.js route handlers, FastAPI), plus cron libraries                                                                                               | `queue`          |
| MCP-only agent        | `.mcp.json`, `.cursor/mcp.json`, `.claude/`, `CLAUDE.md` or `AGENTS.md`. Halved when the repo also has its own agent runtime.                                                                                                     | `mcp`            |

On a tie the more specific shape wins, so an SDK host whose runs go through DBOS reads as an SDK host with DBOS as its dispatcher.

The report names:

- **Run primitive**: the host object that executes one unit of agent work. For a Headways-shaped repo this is `Workstream + AgentRun`.
- **Schedule primitive**: what makes work recur. For Headways this is `Routine`.
- **Persistence**: Prisma, Drizzle, TypeORM, Kysely, Knex, Mongoose, Supabase, SQLAlchemy, or Django ORM.
- **Web framework**: Next.js, React Router, Remix, Hono, Express, Fastify, NestJS, FastAPI, Django, or Flask, with entry files.
- **Auth**: the auth library and the files that call auth guards (`requireAuth`, `requireActiveOrg`, `getServerSession`, `jwtVerify`, and similar).

Every finding carries `file:line` references. `--json` prints the full report, including the lower-ranked candidates.

Example on a Headways-shaped repo:

```text
  Shape:       Claude Agent SDK host (high confidence, 1.00)
  Run:         Workstream + AgentRun
               packages/db/prisma/schema.prisma:5  Prisma model Workstream
               packages/db/prisma/schema.prisma:10  Prisma model AgentRun
  Schedule:    Routine
               packages/db/prisma/schema.prisma:16  Prisma model Routine
  Persistence: Prisma
  Web:         React Router, Hono
  Auth:        JWT (jose or jsonwebtoken), Auth entry points
```

## What it writes

| File                       | Contents                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `celune/harness.ts`        | A `HarnessAdapter` from the matching template, with the detected primitives and file references in its header, `reportRunEvent`, `toRunStatus`, and the run brief. |
| `.celune/harness.json`     | Harness name, template, Celune API URL, workspace id, the name of the credential variable, the agent map placeholder, and the detection summary.                   |
| `.env.celune.example`      | `CELUNE_API_URL`, `CELUNE_WORKSPACE_ID`, the credential variable, and `CELUNE_HOST_JWT_SECRET`, with empty secret values.                                          |
| `.claude/skills/celune-*/` | The three skills below, when the repo uses Claude Code or the Claude Agent SDK.                                                                                    |

Templates:

- **`sdk-workstream`** is modeled on `@celuneai/harness-headways`. `startRun` creates a container for the task (a Workstream) once, then a run inside it with the brief as its first message. You implement a four-method `HostRuntime` against the host's run service.
- **`queue`** enqueues one job per claim with the task and the brief as payload. `getJob` and `cancelJob` are optional and switch on heartbeat and cancel. The header says where to call `reportRunEvent` for the detected queue.
- **`mcp`** is for hosts whose agents are coding sessions. `startRun` records a session and the agent claims and reports through the skills. The adapter is optional for this shape: without one, claims still work and events still apply with the default mapping.

The generated adapters compile under `strict`, `noUncheckedIndexedAccess`, and `erasableSyntaxOnly`.

Rules:

- Nothing is written without `--write`. The dry run prints each file as `+ create`, `~ overwrite`, `! skip`, or `= unchanged` with line counts.
- An existing file that differs is skipped unless you pass `--force`. An identical file is left alone.
- Files are written only inside the target directory.

Options:

| Option               | Default                                                   | Effect                                                                                        |
| -------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `--template <id>`    | the detected template                                     | `sdk-workstream`, `queue`, or `mcp`. Required when nothing matched.                           |
| `--name <harness>`   | `package.json` name without scope, or the directory       | Harness name used in the adapter and in run events.                                           |
| `--api-url <url>`    | `CELUNE_API_URL`, then Celune Cloud                       | Celune API origin. For a self-hosted API use its origin, for example `http://localhost:4000`. |
| `--workspace <id>`   | the workspace saved by `celune setup`, else a placeholder | Celune workspace id.                                                                          |
| `--out-dir <dir>`    | `celune`                                                  | Where the adapter goes.                                                                       |
| `--skills-dir <dir>` | `.claude/skills` when Claude Code is detected             | Where the skills go.                                                                          |
| `--no-skills`        |                                                           | Skip the skills.                                                                              |

## Host runtime skills

The skills ship in the CLI package under `skills/` and use the Celune MCP tools. They contain no host-specific agent names or URLs.

| Skill                 | Use it to                                                                                            | MCP tools                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `celune-task`         | Create one task from the current unit of work: a run, a job, a branch, or a request.                 | `find_task_by_branch`, `list_tasks`, `list_projects`, `create_task`, `add_comment` |
| `celune-project-plan` | Create a project with a brief and 3 to 12 sequenced tasks from a goal, a spec, or a schedule firing. | `list_projects`, `create_project`, `create_task`                                   |
| `celune-status`       | Post progress and the outcome on the claimed task.                                                   | `get_task`, `claim_task`, `add_comment`, `block_task`, `complete_task`             |

`celune-status` checks `metadata.harness_run` first. Inside a harness run for its own task, it only comments, because the run result reports the status; calling `complete_task` as well would move the task twice.

For a harness without a `.claude/skills` directory, `connect` prints the path of the bundled copies. Copy the folders into the harness's skill store. For Headways, the skills become a Headways skill, which is how a Routine creates Celune tasks (decision 4 in [headways.md](./headways.md#what-v1-ships-sprint-4)).

The host agent needs the Celune MCP server registered with a server credential. For a Claude Code session, `npx @celuneai/cli setup` does this. For a runtime like Headways, register `/v1/mcp` as a remote MCP connector with a server JWT whose `sub` is the Celune agent id (see [README.md](./README.md#onboarding-a-new-host), step 7).

## `--check`

```bash
CELUNE_API_KEY=… npx @celuneai/cli connect --check
```

It reads `.celune/harness.json`, takes the credential from the variable named in `credentialEnv` (default `CELUNE_API_KEY`) or from the key `celune setup` saved, and posts one `queued` event to `POST /v1/harness/events` for the task id `00000000-0000-0000-0000-000000000000`. No workspace holds that task, so the event changes nothing. The credential is never printed.

| Response                 | Result                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------- |
| 404 `Resource not found` | Pass. Auth ran before the task lookup, so the credential and route work.               |
| 2xx                      | Pass.                                                                                  |
| 401                      | Fail. The credential is missing or wrong.                                              |
| 403                      | Fail. The key is read-only, or the token is an embed token with a `permissions` claim. |
| 404 with any other body  | Fail. `apiUrl` does not point at the Celune API origin.                                |
| 400                      | Fail. The server refused the event body; the message says why.                         |
| No response              | Fail. The server is unreachable.                                                       |

The exit code is 0 on pass and 1 on fail, so it can run in CI. It does not prove the full loop. After it passes, run the verification in step 9 of [Onboarding a new host](./README.md#onboarding-a-new-host) with a real claim.

## Related

- [README.md](./README.md): the harness contract and the manual onboarding steps
- [headways.md](./headways.md): the reference host
- `packages/cli/src/connect/`: detectors, templates, scaffold, and check
