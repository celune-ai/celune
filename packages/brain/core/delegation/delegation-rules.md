# Delegation Rules

Multi-agent coordination rules for managing parallel work, worktree isolation, escalation, and context handoffs.

## Core Philosophy

The lead agent handles implementation directly rather than delegating to a coding sub-agent. This optimizes for code quality, speed, and token efficiency.

- **Context beats focus.** The lead agent has the user's full intent, tradeoffs discussed, clarifications given. A delegated agent gets a prompt summary — that lossy handoff is where subtle requirements get dropped.
- **Direct implementation is faster.** Every delegation adds overhead: prompt formulation, agent startup, codebase orientation (reading files the lead already read), then output delivery.
- **Delegate only for parallelism, not hierarchy.** When multiple independent tasks can run simultaneously, spin up parallel agents in worktrees. That's a tactical decision per task, not a permanent role.

## Functional Roles

Flat roster — no pods, no utility agents. Each role maps to a single agent.

| Role             | Model  | Scope                                                                  |
| ---------------- | ------ | ---------------------------------------------------------------------- |
| **Lead + Coder** | Opus   | Orchestration, implementation, all coding, delegation decisions        |
| PM + Writer      | Sonnet | Product strategy, PRDs, specs, retros, content in the user's voice     |
| Designer         | Sonnet | UX/UI, design system, prototyping, visual quality                      |
| Code Reviewer    | Sonnet | Code correctness, security review, style (read-only perspective check) |
| Researcher       | Haiku  | Codebase exploration, web research, competitive analysis               |

## Agent Selection Guide

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

## Worktree Isolation

Use git worktrees to prevent parallel agents from overwriting each other's work.

| Scenario                               | Worktree?       |
| -------------------------------------- | --------------- |
| Parallel sub-agents modifying code     | **Required**    |
| Risky refactors or experimental spikes | **Required**    |
| AFK sessions processing multiple tasks | **Recommended** |
| Single sequential agent                | Not needed      |
| Read-only research (Explore agents)    | Not needed      |

**Hard rule:** If you spawn 2+ agents that write code simultaneously, each MUST use `isolation: "worktree"`.

## Agent Contracts

Contract-first spawning replaces ad-hoc prompts with typed delegation contracts.
Each contract defines what an agent receives, what it must produce, and what constraints it operates under.

### Contract Structure

Contracts are stored as `contract_schema` (JSONB) on `agent_configs`:

- **Input contract**: required context keys, files needed, optional JSON schema
- **Output contract**: required response fields, allowed artifacts, optional JSON schema
- **Constraints**: max turns, cost ceiling (USD), tool whitelist/blocklist, isolation mode
- **Permissions**: can_create_tasks, can_modify_schema, read_only, can_push

### Default Contracts

Pre-built contracts exist for standard roles (in `@repo/db/agent-contract`):

| Role          | Model  | Max Cost | Max Turns | Key Restrictions                |
| ------------- | ------ | -------- | --------- | ------------------------------- |
| Code Reviewer | Sonnet | $5       | 50        | Read-only, no Write tool        |
| Designer      | Sonnet | $3       | 30        | Read-only, no Write/Edit        |
| Researcher    | Haiku  | $1       | 40        | Read + web tools only           |
| PM            | Sonnet | $3       | 40        | Can create tasks                |
| Builder       | Opus   | $10      | 100       | Full access, worktree isolation |

### Validation

After an agent completes, validate its output against the contract:

```typescript
import { validateAgentOutput } from '@repo/db/agent-contract';

const result = validateAgentOutput(contract, agentOutput);
if (!result.valid) {
  // Log violations, request retry, or escalate
  console.warn('Contract violations:', result.violations);
}
```

### Cost Enforcement

Check cost ceiling before and during delegation:

```typescript
import { wouldExceedCostCeiling } from '@repo/db/agent-contract';

if (wouldExceedCostCeiling(contract, currentCost)) {
  // Stop the agent, log the cost overrun
}
```

## Sub-Agent Spawning

### Task Hierarchy

Tasks support parent-child relationships through two mechanisms:

1. **`parent_id`** (uuid FK to tasks) — Structural parent for organizing sub-tasks within a larger task.
2. **`spawned_by`** (text) — Records the parent task UUID that triggered creation of this task.

### Delegation Tracking

When a task is reassigned from one agent to another, the system records:

- `metadata.delegated_by` — Previous assignee
- `metadata.delegated_at` — Timestamp of delegation
- `metadata.delegation_reason` — Why it was delegated

### Spawning Sub-Tasks

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

## Escalation

If a sub-agent or team member encounters a blocker:

1. Report via message to the lead agent.
2. The lead agent decides: resolve directly, reassign, or escalate to the user.
3. Never let a blocked agent spin — fail fast and communicate.

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
pnpm task remember --agent lead --content "Auth uses PKCE flow, refresh tokens in httpOnly cookies" --category decision --key "lead:auth-approach"

# Next agent (or same agent in new session) retrieves it
pnpm task recall --agent lead --category decision
```

Memory categories: `preference`, `decision`, `context`, `fact`, `general`, `handoff`.

### AFK Script Budget

Use `--max-turns 50` as default per-task budget. Tasks that regularly hit the limit should be split.
