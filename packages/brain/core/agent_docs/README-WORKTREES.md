# Git Worktrees & Parallel Agent Workflows

This directory contains documentation on using git worktrees to enable parallel work by multiple AI agents.

## Quick Start

**Just spawning 2-3 agents in parallel?**

1. Read: `WORKTREE-SUMMARY.md` (5 min, understand the concept)
2. Read: `worktree-quick-ref.md` (5 min, copy-paste commands)
3. Do it: Spawn agents with `isolation: "worktree"` in Claude Code

**Setting up tmux for visibility?**

1. Read: `TMUX-WORKTREE-SETUP.md` (10 min, visual layout + workflow)
2. Run: The one-liner setup script to create 3-pane session
3. Watch: Tasks kanban in browser as agents work in parallel panes

**Deep understanding & troubleshooting?**

1. Read: `WORKTREE-VISUAL-GUIDE.md` and `worktree-quick-ref.md` in this directory
2. Understand: Gotchas section (lock files, node_modules, branch collisions)
3. Reference: Quick commands cheat sheet for edge cases

---

## Files

| File                     | Length | Purpose                                                       | Audience                                           |
| ------------------------ | ------ | ------------------------------------------------------------- | -------------------------------------------------- |
| `WORKTREE-SUMMARY.md`    | 3 KB   | High-level overview of what worktrees are and why they matter | Everyone                                           |
| `worktree-quick-ref.md`  | 2 KB   | Commands, golden rules, troubleshooting quick fixes           | Lead agent (spawning) + Sub-agents (working)       |
| `TMUX-WORKTREE-SETUP.md` | 6 KB   | Visual layout, tmux commands, step-by-step parallel workflow  | Lead agent + operators running multi-pane sessions |

---

## Cheat Sheets

### For the Lead Agent (Spawning Agents)

**Spawn a sub-agent in a worktree:**

```typescript
Agent {
  name: "writer-prd",
  isolation: "worktree",
  prompt: "Your task... (include task ID)"
}
```

**After agents report completion, merge their work:**

```bash
git fetch origin
git merge --no-ff origin/writer-prd -m "Merge PR updates"
git merge --no-ff origin/reviewer-types -m "Merge type updates"
git worktree remove .claude/worktrees/writer-prd
git worktree remove .claude/worktrees/reviewer-types
git push origin main
```

### For Sub-Agents (Working in Worktrees)

**You auto-land in a worktree on your first turn:**

```bash
$ pwd
{{HOME}}/your-project/.claude/worktrees/writer-prd

$ git branch
* writer-prd  # Your branch (auto-created)
  main
```

**Your workflow:**

1. `pnpm task claim <task-id> --agent <your-name>`
2. Do your work (only relevant files)
3. `git commit -m "Descriptive message"`
4. `pnpm task complete <task-id> --agent <your-name>`
5. Return to the lead agent with worktree path and branch name

**Golden rules:**

- Always commit before returning
- Don't modify package.json (only the lead agent does)
- Use unique branch names (your name prefixed)
- Scope changes to relevant files only

### For Troubleshooting

| Problem                                     | Fix                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `fatal: unable to create '.git/index.lock'` | `rm -f .git/index.lock` in that worktree                                             |
| Branch already checked out elsewhere        | Use unique branch name: `writer-prd`, not `feat-auth`                                |
| Stale worktree references                   | `git worktree prune` then `git worktree list`                                        |
| Forgot to commit                            | If worktree still exists: `git status` + `git commit`. If deleted: changes are lost. |

---

## Real-World Example

**Scenario:** The lead agent needs to parallelize auth system work across PRD and types.

**Step 1: Create tasks (lead agent)**

```bash
pnpm task create "Rewrite auth PRD" --tags "prd,auth"
pnpm task create "Add auth TypeScript types" --tags "types,auth"
```

**Step 2: Spawn agents (lead agent, in Claude Code)**

```typescript
Agent {
  name: "writer-prd",
  isolation: "worktree",
  prompt: `
    Task: Rewrite auth PRD (task-123)
    1. Claim: pnpm task claim task-123 --agent writer
    2. Edit: docs/auth-refactor.md
    3. Commit: git commit -m "Update auth PRD with new flows"
    4. Complete: pnpm task complete task-123 --agent writer
    5. Report branch name and changed files
  `
}

Agent {
  name: "reviewer-types",
  isolation: "worktree",
  prompt: `
    Task: Add auth types (task-124)
    1. Claim: pnpm task claim task-124 --agent reviewer
    2. Add: packages/types/src/auth-types.ts
    3. Test: packages/types/src/__tests__/auth-types.test.ts
    4. Commit: git commit -m "Add AuthFlow and PermissionSet types"
    5. Complete: pnpm task complete task-124 --agent reviewer
    6. Report branch name and changed files
  `
}
```

**Step 3: Parallel execution**

- Writer auto-enters `.claude/worktrees/writer-prd` on `writer-prd` branch
- Reviewer auto-enters `.claude/worktrees/reviewer-types` on `reviewer-types` branch
- Both work simultaneously, no conflicts
- Lead agent watches kanban in admin UI (real-time SSE updates)

**Step 4: Merge (lead agent)**

```bash
git fetch origin
git merge --no-ff origin/writer-prd -m "Merge auth PRD"
git merge --no-ff origin/reviewer-types -m "Merge auth types"
git worktree remove .claude/worktrees/writer-prd
git worktree remove .claude/worktrees/reviewer-types
pnpm test
git push origin main
```

**Result:** Two independent features merged in parallel, zero conflicts, clean history.

---

## Key Concepts

**Git Worktrees:**

- Separate working directories, shared `.git`
- Each worktree can checkout a different branch simultaneously
- No stashing, no branch switching — true parallelism

**Claude Code Integration:**

- `EnterWorktree` tool auto-creates worktrees
- `isolation: "worktree"` parameter on Agent tool
- Sub-agents auto-land in worktrees on first turn

**Lead Agent's Role:**

- Owns main branch, integration, merges
- Spawns agents with unique branch names
- Reviews branches, merges least-conflicting first
- Cleans up worktrees after merge

**Sub-Agents' Role:**

- Work in isolated worktree (own branch)
- Modify only relevant files
- Commit before returning
- Report progress via task system

**Task System Integration:**

- Agents claim/complete tasks in real-time
- Kanban live-streams via SSE
- Lead agent can monitor progress without manual checks
- Blocks tracked if agent gets stuck

---

## When to Use Worktrees

**Use worktrees when:**

- 2+ agents work on independent tasks in parallel
- Features are isolated (touch different files)
- AFK sessions process multiple tasks
- You need true parallelism (not sequential)

**Skip worktrees when:**

- Single agent/developer working
- Tasks run sequentially (one at a time)
- Agent does read-only research
- Quick hotfixes (branch switching is faster)

---

## Further Reading

- **How Git Worktrees Work:** `WORKTREE-VISUAL-GUIDE.md` in this directory
- **Gotchas & Recovery:** `worktree-quick-ref.md` in this directory
- **Task claiming and reporting:** `task-management.md` in this directory, `docs/harness/README.md` in the Celune repository, and the agent protocol reference at `/api-reference/agent-protocol` in the Celune docs
- **Worktree Skill:** `.claude/skills/worktree-workflow/CLAUDE.md`

---

## Quick Links

| Link                                         | Purpose                                            |
| -------------------------------------------- | -------------------------------------------------- |
| `.claude/skills/worktree-workflow/CLAUDE.md` | When to use worktrees (scope rules, anti-patterns) |
| `docs/harness/README.md` (Celune repository) | How agents claim work and report runs              |
| `.tmux.conf`                                 | tmux keybindings (Alt+arrow for pane switching)    |
| `packages/db/scripts/task-cli.mjs`           | Task CLI (claim, complete, block, comment)         |

---

## Summary

Git worktrees enable true parallel work by AI agents:

1. Each agent gets own isolated worktree + branch
2. Claude Code handles creation via `isolation: "worktree"`
3. Lead agent spawns agents, watches kanban, merges serially
4. Zero conflicts, clean git history, scalable to 3+ agents

For quick start: Read `WORKTREE-SUMMARY.md`, then spawn agents with `isolation: "worktree"`.
