# Delegation Protocol

How the lead agent decides whether to handle a task directly, spawn a sub-agent, or stand up an agent team.

## Core Philosophy: The Lead Agent Codes Directly

The lead agent handles implementation directly rather than delegating to a coding sub-agent. This optimizes for code quality, speed, and token efficiency.

**Why:**

- **Context beats focus.** The lead agent has the user's full intent, tradeoffs discussed, clarifications given. A delegated agent gets a prompt summary — that lossy handoff is where subtle requirements get dropped.
- **Direct implementation is faster.** Every delegation adds overhead: prompt formulation, agent startup, codebase orientation (reading files the lead already read), then output delivery. 30-60 seconds of latency with no quality gain.
- **Iteration stays in the conversation.** Coding is iterative. Back-and-forth works when the coder is in the conversation, not behind a delegation layer.
- **Quality gates come from perspective, not authorship.** The Code Reviewer provides an independent quality check on the lead agent's code. The value is a different perspective, not a different author.

**Delegate only for parallelism, not hierarchy.** When multiple independent tasks can run simultaneously, spin up parallel agents in worktrees. That's a tactical decision per task, not a permanent role.

## Mode Selection

| Signal           | Solo (Lead) | Sub-agents | Agent Team  |
| ---------------- | ----------- | ---------- | ----------- |
| Impl tasks       | 1-5         | 6-8        | 9+          |
| Sprints          | Any         | <=3        | 3+          |
| Domain spread    | Any         | <=3 agents | 3+ agents   |
| Dependency depth | Any         | <=3        | Deep chains |

**Decision tree:**

```
Is there an explicit override? -> Use that mode
Else:
  impl_tasks <= 5 AND all effort <= L -> Solo
  impl_tasks <= 8 AND sprints <= 3 -> Sub-agents
  Otherwise -> Agent Team
```

### Override Keywords

| User says                                       | Mode             |
| ----------------------------------------------- | ---------------- |
| `agent team`, `spin up a team`, `full team`     | Force Agent Team |
| `yourself`, `solo`, `just do it`, `handle this` | Force Solo       |
| `with sub-agents`, `delegate this`              | Force Sub-agents |

## When the Lead Agent Codes Directly

- Everything with <=5 tasks
- Anything requiring the user's intent, architectural judgment, or iterative refinement
- Security-sensitive implementations
- Tasks that build on context the lead already has

## When to Delegate

- Multiple independent files or features that can be built in parallel
- Mechanical transformations (bulk renames, format migrations) where context doesn't matter
- Prototype exploration — try 2-3 approaches simultaneously and compare
- Research and investigation (Researcher agent)
- Code review (Code Reviewer reviews the lead agent's code)
- Large project closing tasks (QA, retrospectives)

## RFC Requirement

- **S/M effort tasks:** Skip RFC. Just implement directly.
- **L/XL effort tasks:** Write a brief RFC as a task comment before implementing. Cover: Problem, Proposed Solution, Technical Approach, Testing Strategy.

## Functional Roles

Flat roster — no pods, no utility agents. Each role maps to a single agent.

| Role             | Model  | Scope                                                                  |
| ---------------- | ------ | ---------------------------------------------------------------------- |
| **Lead + Coder** | Opus   | Orchestration, implementation, all coding, delegation decisions        |
| PM + Writer      | Sonnet | Product strategy, PRDs, specs, retros, content in the user's voice     |
| Designer         | Sonnet | UX/UI, design system, prototyping, visual quality                      |
| Code Reviewer    | Sonnet | Code correctness, security review, style (read-only perspective check) |
| Researcher       | Haiku  | Codebase exploration, web research, competitive analysis               |

### Agent Selection Guide

| Task Domain                                      | Agent                |
| ------------------------------------------------ | -------------------- |
| Product strategy, roadmap, feature scoping, PRDs | PM                   |
| Architecture, code, engineering, bug fixes       | Lead (directly)      |
| UX/UI, design system, prototyping                | Designer             |
| Code review, QA, test review                     | Code Reviewer        |
| Web research, competitive analysis, trends       | Researcher           |
| Security audit, threat modeling                  | Lead + Code Reviewer |
| Content, copywriting, docs                       | PM                   |
| CI/CD, deployment, infra, monitoring             | Lead (directly)      |
| Testing, test writing                            | Lead (directly)      |
| Cross-domain, ambiguous                          | Lead                 |

## Model Selection

| Tier   | Model  | Use For                                                      |
| ------ | ------ | ------------------------------------------------------------ |
| Tier 1 | Opus   | Lead — long sessions, full context, max reasoning            |
| Tier 2 | Sonnet | PM, Designer, Code Reviewer — nuanced work requiring quality |
| Tier 3 | Haiku  | Researcher — bounded tasks, research, formulaic work         |

### Cost Rates (per million tokens)

| Tier   | Model  | Input  | Output | Cache Read | Cache Write |
| ------ | ------ | ------ | ------ | ---------- | ----------- |
| Tier 1 | Opus   | $15.00 | $75.00 | $1.50      | $18.75      |
| Tier 2 | Sonnet | $3.00  | $15.00 | $0.30      | $3.75       |
| Tier 3 | Haiku  | $0.80  | $4.00  | $0.08      | $1.00       |

**Cost-aware routing:**

- Default to the cheapest tier that can handle the task. Research -> Haiku. Code review -> Sonnet. Architecture -> Opus.
- Sonnet is 5x cheaper than Opus on input, 5x on output. Haiku is ~19x cheaper than Opus on input.
- Prompt caching saves ~90% on cached input tokens — structure prompts for cache hits (see below).

### Context Window Optimization

- **Keep prompts tight.** Agent CLAUDE.md specs should be under 200 lines.
- **Prefer Haiku sub-agents for research.** Spawn Haiku agents to gather context, then process in the lead's context.
- **Batch tool calls.** Parallel tool calls reduce round-trips and context usage.
- **Use `model` parameter on Agent tool.** Override: `model: "haiku"` for quick lookups, `model: "opus"` for complex work.
- **Scope tasks narrowly.** A task touching 3 files beats one touching 10.

## Prompt Caching Guidelines

Anthropic's prompt caching caches from the **start of the prompt**. Structure agent prompts so stable content comes first and variable content comes last.

### Stable Prefix Pattern

Order prompt sections from most-stable to most-variable:

```
1. Identity      — who the agent is (never changes)
2. Rules         — guardrails and constraints (rarely changes)
3. Process       — how to execute (changes occasionally)
4. Task content  — specific task details (changes every run)
```

### Guidelines for Cacheable Prompts

- **Do:** Put identity, guardrails, and process steps before task variables.
- **Do:** Keep the variable section clearly delimited (`## Your Task` at the end).
- **Do:** Use consistent wording in stable sections — even minor changes break the cache.
- **Don't:** Interpolate task data into the middle of identity or rules sections.
- **Don't:** Put timestamps, task IDs, or session-specific info anywhere except the variable block.
- **Don't:** Vary system prompt structure between calls.

## Task Integration

Agent teams write directly to the task system so the admin kanban updates in real time. All write commands output JSON to stdout and log entries to the `activity_log` table.

### Access Methods

There are two ways agents interact with the task system:

**1. CLI (shell out from any script or agent):**

```
node packages/db/scripts/task-cli.mjs <command> [options]
pnpm task <command> [options]
```

**2. MCP Server (structured tool calls from Claude Code agents):**

The platform serves MCP at `/api/mcp` (see `apps/platform/src/lib/mcp/registry.ts`), authenticated with a workspace API key. It exposes the same operations as the CLI (`list_tasks`, `get_task`, `create_task`, `claim_task`, `complete_task`, `block_task`, `add_comment`, plus project, memory, and job tools) so agents can manage the kanban board without shelling out. The CLI and the MCP tools share one lifecycle implementation in `packages/core` (`@celuneai/core`), so status moves, dependency checks, and activity rows behave the same on both surfaces.

### Task Statuses

```
backlog -> inbox -> planning -> assigned -> in_progress -> review -> done -> archived
```

Common lifecycle: `inbox` (new task arrives) -> `in_progress` (agent claims it) -> `done` (agent completes it). Tasks can also pass through `planning` and `review` for larger work.

### Task Priorities

`urgent` | `high` | `normal` | `low`

### Task Effort Estimates

`S` (<15 min) | `M` (15-60 min) | `L` (1+ hours)

Set via `--effort S|M|L` on create or update commands. Use `--effort none` to clear.

### CLI Command Reference

#### create — Create a new task

```bash
pnpm task create \
  --title "Implement auth flow" \
  --assignee lead \
  --status inbox \
  --project <project-uuid> \
  --description "Add OAuth2 login with GitHub provider" \
  --outcome "Users can sign in with GitHub" \
  --priority high \
  --effort M \
  --category "auth,frontend" \
  --depends-on <task-uuid>,<task-uuid> \
  --spawned-by <parent-task-uuid>
```

Only `--title` is required. Defaults: `status=inbox`, `assignee=unassigned`, `priority=normal`. The `--spawned-by` flag links this task to a parent task for sub-task tracking. The `--depends-on` flag sets dependency UUIDs — if any dependency is not `done`, the task is auto-blocked by a database trigger.

#### claim — Claim a task and start working

```bash
pnpm task claim <task-id> --agent lead
```

Sets status to `in_progress`, assigns the agent, records `claimed_at` and `active_session: true` in metadata. If the task was previously assigned to a different agent, records delegation metadata (`delegated_by`, `delegated_at`). Also updates the `agent_status` table to `working` with the current task ID, and writes a session-task link file (`~/.claude/session-task.json`) so the Stop hook can correlate the Claude Code session to the task.

#### complete — Mark a task done

```bash
pnpm task complete <task-id> --agent lead --outcome "Shipped OAuth2 flow with GitHub provider"
```

Sets status to `done`, records `completed_at` timestamp and `completed_by` in metadata, clears the `active_session` flag. Updates `agent_status` to `online` with no active task. Clears the session-task link file. The optional `--outcome` flag records a results summary on the task.

#### block — Flag a task as blocked

```bash
pnpm task block <task-id> --reason "Need API key for X" --agent lead
```

Sets `blocked: true`, `blocked_at`, `blocked_reason`, and `blocked_by` in task metadata. Does not change the task status column — the task stays in its current status with a blocked overlay.

#### unblock — Remove blocked state

```bash
pnpm task unblock <task-id>
```

Removes all blocked metadata fields (`blocked`, `blocked_at`, `blocked_reason`, `blocked_by`).

#### update — Update task fields

```bash
pnpm task update <task-id> \
  --status review \
  --title "Updated title" \
  --assignee pm \
  --priority high \
  --description "Updated description" \
  --outcome "Results summary" \
  --project <project-uuid> \
  --depends-on <uuid>,<uuid> \
  --effort M \
  --reason "Delegating because PM handles PRDs"
```

General-purpose update for any task field. When `--assignee` changes and `--reason` is provided, records delegation metadata (`delegated_by`, `delegated_at`, `delegation_reason`). Setting `--status done` automatically sets `completed_at`.

#### comment — Add a comment to a task

```bash
pnpm task comment <task-id> --author lead --content "Implemented via OAuth2 PKCE flow"
```

Inserts into the `task_comments` table. Comments appear in the task drawer in the admin UI.

#### list — List tasks with filters

```bash
pnpm task list --status in_progress --assignee lead --project <uuid> --limit 20
```

Returns tasks ordered by `sort_order`. Default limit is 50. All filter flags are optional.

#### heartbeat — Update agent status

```bash
pnpm task heartbeat --agent lead --status working --model claude-opus-4-6
```

Upserts into the `agent_status` table with the agent's current status and `last_heartbeat` timestamp. Valid statuses: `online`, `working`, `idle`, `offline`. The optional `--model` flag records which model the agent is running on.

#### remember — Store agent memory

```bash
pnpm task remember --agent lead --content "The user prefers Tailwind over CSS modules" --category preference --key "lead:tailwind-pref"
```

Upserts into the `agent_memory` table. Categories: `preference`, `decision`, `context`, `fact`, `general`, `handoff`. If `--key` is not provided, generates one from `<agent>:<timestamp>`. Useful for persisting decisions, context, and handoff notes across sessions.

#### recall — Retrieve agent memories

```bash
pnpm task recall --agent lead --category decision --limit 10
```

Queries `agent_memory` filtered by agent (source) and optionally by category. Returns most recently updated entries first.

### Kanban Effects

| Agent Action      | Kanban Effect                                 |
| ----------------- | --------------------------------------------- |
| `create`          | Card appears in target column                 |
| `claim`           | Card moves to In Progress, agent badge pulses |
| `block`           | Red "Blocked" badge appears on card           |
| `unblock`         | Blocked badge removed                         |
| `complete`        | Card moves to Done                            |
| `comment`         | Visible in task drawer                        |
| `update --status` | Card moves to target column                   |

## Agent Heartbeat System

The heartbeat system tracks which agents are currently active and what they are working on.

### Database Schema (`agent_status` table)

| Column            | Type          | Purpose                                   |
| ----------------- | ------------- | ----------------------------------------- |
| `agent_name`      | text (unique) | Agent identifier (e.g., `lead`, `pm`)     |
| `status`          | enum          | `online`, `working`, `idle`, `offline`    |
| `current_task_id` | uuid          | FK to active task (null when idle/online) |
| `model`           | text          | Current model (e.g., `claude-opus-4-6`)   |
| `last_heartbeat`  | timestamptz   | Last heartbeat timestamp                  |

### Status Transitions

```
Session starts  -> heartbeat --status online
Task claimed    -> automatic: status=working, current_task_id=<task-id>
Task completed  -> automatic: status=online, current_task_id=null
Session ends    -> heartbeat --status offline
Idle (no work)  -> heartbeat --status idle
```

When an agent calls `claim`, the CLI automatically updates `agent_status` to `working` with the task ID. When an agent calls `complete`, it resets to `online` with no task. Manual heartbeats (`pnpm task heartbeat`) are used for session start/end and idle detection.

### Session-Task Link

When a task is claimed, the CLI writes `{ session_id, task_id }` to `~/.claude/session-task.json`. This file lets the Stop hook (fired after each Claude response) correlate the active Claude Code session to the task being worked on. On task completion, this file is cleared.

## Cost Tracking

Token usage and cost are tracked per session, per agent, per task in the `claude_usage` table.

### How It Works

1. **capture-usage.mjs** — A post-session script that parses Claude CLI JSON output and posts token usage to the admin cost ingestion API (`/api/analytics/cost/ingest`).

2. **Invocation patterns:**

   ```bash
   # From CLI args:
   node packages/db/scripts/capture-usage.mjs \
     --json '{"total_cost_usd":0.042,"usage":{"input_tokens":1000,...},"model":"claude-opus-4-6"}' \
     --session-id abc123 \
     --agent-name lead \
     --task-id <uuid>

   # From piped claude output:
   claude -p "..." --output-format json | \
     node packages/db/scripts/capture-usage.mjs \
       --agent-name lead \
       --task-id <uuid>
   ```

3. **Data captured per session:**
   - `session_id` — Claude session identifier (auto-read from `CLAUDE_SESSION_ID` env var)
   - `agent_name` — Which agent ran the session
   - `task_id` — Which task was being worked on
   - `model` — Model used (e.g., `claude-opus-4-6`)
   - `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`
   - `total_cost_usd` — Computed cost
   - `duration_ms` — Session duration

4. **Aggregation:** The `claude_usage_daily` view provides daily rollups by model and agent for the cost dashboard. Per-task usage is available via `/api/tasks/[id]/usage`.

### Per-Task Cost Visibility

The admin API aggregates all `claude_usage` rows for a task ID, returning total tokens, cost, duration, and models used. This shows up in the task drawer so you can see what each task actually cost.

## Sub-Agent Spawning

### Task Hierarchy

Tasks support parent-child relationships through two mechanisms:

1. **`parent_id`** (uuid FK to tasks) — Structural parent for organizing sub-tasks within a larger task.
2. **`spawned_by`** (text) — Records the parent task UUID that triggered creation of this task. Indexed for efficient lookup of all tasks spawned by a given parent. The admin API at `/api/tasks/[id]/spawned` returns all child tasks.

### Delegation Tracking

When a task is reassigned from one agent to another, the system records:

- `metadata.delegated_by` — Previous assignee
- `metadata.delegated_at` — Timestamp of delegation
- `metadata.delegation_reason` — Why it was delegated (if `--reason` provided on update)

The delegation flow API (`/api/agents/delegations`) computes edges between agents based on this metadata, showing delegation patterns in the admin UI.

### Spawning Sub-Tasks from an Agent

```bash
# Parent agent creates a sub-task for another agent
pnpm task create \
  --title "Research OAuth providers" \
  --assignee researcher \
  --status inbox \
  --spawned-by <parent-task-uuid> \
  --priority normal \
  --effort S

# Sub-agent claims and works the task
pnpm task claim <new-task-id> --agent researcher
# ... does the work ...
pnpm task complete <new-task-id> --agent researcher --outcome "Evaluated 3 providers, Auth0 recommended"
```

### Dependency-Based Auto-Blocking

Tasks with `depends_on` UUIDs are automatically blocked/unblocked by a database trigger:

- When `depends_on` is set, the trigger checks if all dependency tasks are `done`. If any are not, the task's metadata is updated with `blocked: true` and `blocked_reason: "Waiting on dependencies"`.
- When a dependency task moves to `done`, the trigger checks all tasks that depend on it and unblocks those whose dependencies are now all satisfied.

This means you can set up a pipeline of tasks and they will automatically unblock in order:

```bash
# Create tasks with dependency chain
pnpm task create --title "Design schema" --assignee lead
# returns id: aaa...
pnpm task create --title "Implement API" --assignee lead --depends-on aaa
# returns id: bbb... (auto-blocked until aaa is done)
pnpm task create --title "Build UI" --assignee designer --depends-on bbb
# returns id: ccc... (auto-blocked until bbb is done)
```

## Context Management Protocol

Long-running sessions accumulate context that degrades quality and inflates cost. Compact proactively.

### When to Hand Off

- At ~50% context utilization, evaluate whether to compact or hand off.
- After completing a discrete deliverable, treat it as a natural compaction point.
- Three 40K-token sessions outperform a single 180K session.

### Handoff Format

```
## Context Handoff

**Task:** [task title + ID]
**Status:** [what's done / what remains]

**Key decisions:**
- [decision 1 and why]

**Files changed:**
- [path:line] — [what changed]

**Next action:** [exact next step]
**Open questions:** [any blockers]
```

### Cross-Agent Memory Handoff

Use `remember` and `recall` to persist context across sessions and agents:

```bash
# Agent finishing work stores key context
pnpm task remember --agent lead --content "Auth uses PKCE flow with Auth0, refresh tokens stored in httpOnly cookies" --category decision --key "lead:auth-approach"

# Next agent (or same agent in new session) retrieves it
pnpm task recall --agent lead --category decision
```

Memory categories: `preference`, `decision`, `context`, `fact`, `general`, `handoff`.

### AFK Script Budget

Use `--max-turns 50` as default per-task budget. Tasks that regularly hit the limit should be split.

## Worktree Isolation

Use git worktrees to prevent parallel agents from overwriting each other's work.

### When Worktrees Are Required

| Scenario                               | Worktree?       |
| -------------------------------------- | --------------- |
| Parallel sub-agents modifying code     | **Required**    |
| Risky refactors or experimental spikes | **Required**    |
| AFK sessions processing multiple tasks | **Recommended** |
| Single sequential agent                | Not needed      |
| Read-only research (Explore agents)    | Not needed      |

**Hard rule:** If you spawn 2+ agents that write code simultaneously, each MUST use `isolation: "worktree"`.

## Escalation

If a sub-agent or team member encounters a blocker:

1. Report via message to the lead agent.
2. The lead agent decides: resolve directly, reassign, or escalate to the user.
3. Never let a blocked agent spin — fail fast and communicate.
