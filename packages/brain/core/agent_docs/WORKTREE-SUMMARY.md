# Git Worktrees for AI Agent Teams: Executive Summary

## What Are Git Worktrees?

Git worktrees are **separate working directories that share a single `.git` folder**. Instead of checking out different branches in the same directory (which forces stashing), each worktree is an isolated filesystem snapshot of its own branch.

```
Physical Layout:
.git (shared)
+-- objects/ (all commits, shared)
+-- refs/    (branch references, locked per-worktree)
+-- worktrees/ (metadata)

/primary/      (main branch)
/worktree-A/   (branch A)
/worktree-B/   (branch B)
```

**Key insight:** Worktrees are **simultaneous** — A, B, and main can all be checked out at the same time.

---

## Claude Code Integration

Claude Code has native worktree support via the `EnterWorktree` tool and `isolation: "worktree"` parameter on the Agent tool.

### For the Lead Agent:

```typescript
Agent {
  name: "writer-prd",
  isolation: "worktree",  // Agent auto-enters worktree on first turn
  prompt: "Your task..."
}
```

### For Sub-Agents:

```bash
# You automatically land in a worktree:
$ pwd
{{HOME}}/your-project/.claude/worktrees/writer-prd

$ git branch
* writer-prd  # Your isolated branch
  main
```

No manual setup needed — Claude Code handles it.

---

## Why Worktrees Beat Branch Switching for Multi-Agent Work

| Scenario                                              | Branch Switching       | Worktrees                                |
| ----------------------------------------------------- | ---------------------- | ---------------------------------------- |
| 1 agent on main                                       | Fast, simple           | Overkill                                 |
| 2+ agents in parallel                                 | Broken (stashing hell) | Perfect                                  |
| Agent A touches `auth.ts`, Agent B touches `types.ts` | Sequential only        | Truly parallel                           |
| Merging Agent A's work while Agent B continues        | Impossible             | Normal (lead agent merges independently) |
| Risk of accidental overwrites                         | HIGH                   | ZERO (separate branches)                 |

**Bottom line:** For 2+ parallel agents, worktrees aren't optional — they prevent conflicts.

---

## The Workflow

### Phase 1: Plan (Lead Agent)

```bash
node packages/db/scripts/task-cli.mjs create "Rewrite auth PRD"
node packages/db/scripts/task-cli.mjs create "Add auth types"
```

### Phase 2: Spawn (Lead Agent)

```typescript
// Spawn 2 agents
Agent { name: "writer-prd", isolation: "worktree", prompt: "..." }
Agent { name: "reviewer-types", isolation: "worktree", prompt: "..." }
```

### Phase 3: Parallel Work

```
Lead (main)         Writer (writer-prd)    Reviewer (reviewer-types)
+- Review           +- Modify docs/        +- Modify packages/types/
+- Watch kanban     +- git commit          +- git commit
+- Prepare merge    +- Task complete       +- Task complete
```

### Phase 4: Merge (Lead Agent)

```bash
git fetch
git merge --no-ff origin/writer-prd
git merge --no-ff origin/reviewer-types
git worktree remove .claude/worktrees/writer-prd
git worktree remove .claude/worktrees/reviewer-types
```

---

## Critical Gotchas

### 1. Shared node_modules

**Problem:** Two agents can't simultaneously modify `package.json` -> pnpm-lock.yaml conflicts.

**Solution:** Only the lead agent modifies `package.json`. Sub-agents use existing `node_modules` (read-only safe).

### 2. Branch Name Collisions

**Problem:** Git can't check out the same branch in 2 worktrees -> index lock conflict.

**Solution:** Each worktree must have a **unique branch name**.

- Lead: `main`
- Writer: `writer-prd`
- Reviewer: `reviewer-types`

### 3. Forgotten Commits

**Problem:** Agent exits without committing -> worktree is removed -> changes vanish.

**Solution:** Enforce in agent prompts: "Always commit before returning."

### 4. Stale Worktree References

**Problem:** Worktree deleted outside git -> git still tracks it -> "worktree is broken" errors.

**Solution:** `git worktree prune` cleans stale refs.

---

## When to Use Worktrees

| Use Case                                       | Worktree?                  |
| ---------------------------------------------- | -------------------------- |
| Lead + 2 sub-agents doing independent tasks    | **YES**                    |
| Lead alone on main                             | No                         |
| Single agent doing read-only research          | No                         |
| AFK session with 3+ tasks                      | **YES**                    |
| Emergency hotfix while feature work is ongoing | **YES**                    |
| Sequential tasks (one at a time)               | No (branch switching fine) |

---

## Recovery Commands

```bash
# View all active worktrees
git worktree list

# Clean stale references
git worktree prune

# If index is locked
rm -f .git/index.lock

# Repair broken symlinks (macOS)
git worktree repair

# Check worktree status
git worktree list --porcelain
```

---

## Files to Reference

1. **Deep dive:** `README-WORKTREES.md` and `WORKTREE-VISUAL-GUIDE.md` in this directory
2. **Quick ref:** `worktree-quick-ref.md` in this directory (troubleshooting, commands)
3. **Skill:** `.claude/skills/worktree-workflow/CLAUDE.md` (when to use, scope rules)

---

## TL;DR

- **Worktrees** = separate directories, same `.git`, simultaneous branches
- **Claude Code support** = `isolation: "worktree"` on Agent tool
- **Best for** = 2+ parallel agents (prevents conflicts, enables true parallelism)
- **Lead agent's job** = spawn agents, merge their branches serially
- **Golden rule** = each agent gets unique branch name (`writer-prd`, `reviewer-types`, etc.)
- **On merge** = lead agent reviews, merges least-conflicting first, cleans up worktrees
- **Safety** = all changes committed to branch before worktree removal

---

## Quick Example: Spawning Parallel Agents

```typescript
// Lead agent's session

// Create tasks
pnpm task create "PRD rewrite" --tags "prd,auth"
pnpm task create "Type safety" --tags "types,auth"

// Spawn agents
Agent {
  name: "writer-prd",
  isolation: "worktree",
  prompt: `
    Claim task task-123, rewrite auth PRD, commit, complete task.
    Your worktree: .claude/worktrees/writer-prd
    Your branch: writer-prd
  `
}

Agent {
  name: "reviewer-types",
  isolation: "worktree",
  prompt: `
    Claim task task-124, add auth types, write tests, commit, complete task.
    Your worktree: .claude/worktrees/reviewer-types
    Your branch: reviewer-types
  `
}

// Wait for both agents to report completion
// Then merge
git merge --no-ff origin/writer-prd
git merge --no-ff origin/reviewer-types
git push origin main
```

That's it. Parallel agents, isolated work, clean merges.
