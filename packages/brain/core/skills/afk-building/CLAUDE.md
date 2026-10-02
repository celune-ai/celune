---
name: afk-building
description: 'Autonomous overnight feature builder — picks planned tasks, writes RFCs, delegates to sub-agents.'
user_invocable: true
requires:
  bins: [node, pnpm]
---

# afk-building

Platform engineering build mode. RICK picks product tasks from Planned column, writes RFCs, delegates to sub-agents, produces completion reports.

**Scope:** celune-platform product work only. Web apps, APIs, UI, DB, infra, security.
**Out of scope:** Agent system improvements → `/afk-learning`. Quick fixes → `/afk-housekeeping`.

---

## On Invocation

1. Check sentinel: `~/.claude/state/afk_active` (abort if already running)
2. Set sentinel + timeout (default 4h, override with `timeout=2h`)
3. Confirm to the user

## Build Cycle

### Step 1: Task Selection

Pull planned tasks assigned to rick. Filter to platform tags only (`admin-app`, `docs-site`, `design-system`, `task-system`, `code-quality`, `security`, `infra`, `revenue`, `personal-brand`). Skip `agent-system`/`knowledge` tags.

**PRD Approval Gate:** Check parent project's `prd_metadata.status`. Skip unapproved projects.

**Read `refs/full-reference.md` for PRD gate code.**

Selection priority: dependency order → priority → foundation before features → smallest unblocking unit → effort grouping.

Claim: `node packages/db/scripts/task-cli.mjs claim {task_id} --agent rick`

### Step 2: RFC

**Read `refs/full-reference.md` for RFC template.**

Write RFC as task comment (NOT description). Sections: Problem Statement, Proposed Solution, Technical Design, Security, Testing Strategy, Rollback, Effort Estimate.

### Step 3: Sub-Agent Staffing

**Read `refs/full-reference.md` for orchestration tiers and staffing rules.**

| Tier | When                    | Action                                               |
| ---- | ----------------------- | ---------------------------------------------------- |
| 1    | S/M effort, <3 files    | Execute directly                                     |
| 2    | M/L effort, 2-4 streams | Spawn sub-agents with `run_in_background: true`      |
| 3    | XL effort, 4+ streams   | Requires the maintainer's approval, use `TeamCreate` |

### Step 4: Execution

Work through RFC. Commit after each logical unit. Run verification per CLAUDE.md. If blocked: flag and move to next task. If scope creeps: create new tasks.

### Step 5: Completion Report

**Read `refs/full-reference.md` for report template and email script.**

Write report to `memory/overnight/afk-{timestamp}-{task_id}.md` + task outcome. Email if AGENTMAIL_API_KEY set.

### Step 6: Finalize

```bash
node packages/db/scripts/task-cli.mjs complete <task-id> --agent rick --outcome "..."
```

Check stop conditions, pick up next task.

## Stop Conditions

- `~/.claude/state/afk_active` removed
- Past 5 PM
- No more planned tasks
- Timeout exceeded

## On Return

Remove sentinel. Summarize: completed tasks, in-review tasks, blocked tasks, branches, duration. Clean up temp files.

## Best Practices

- **Auth:** `createServiceClient()` server-side only. Never expose service keys client-side.
- **Validation:** Validate at API boundaries. Use Zod or manual type guards.
- **RLS:** Every new table needs policies. **Migrations:** Auto-copy to `~/Documents/SQL Editor/`.
- **Types:** `@repo/types` is single source of truth. **Design tokens:** Use theme.css, no hardcoded colors.
- **Commits:** Clear messages, atomic changes, Co-Authored-By. **No over-engineering.**
