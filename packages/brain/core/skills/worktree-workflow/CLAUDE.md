---
name: worktree-workflow
description: "Protocol for using git worktrees for parallel agent work.\n  TRIGGER when: multiple agents need to write code simultaneously on the same branch, or when isolation is needed for parallel tasks.\n  This is a protocol skill — it guides HOW to use worktrees, not WHEN to start."
user_invocable: false
---

# Worktree Workflow Protocol

Git worktrees allow multiple agents to work on the same repository simultaneously without conflicts. Each agent gets its own working directory with its own branch, sharing the same git history.

## When to Use

- 2+ agents need to write code in the same sprint
- Parallel task execution that touches different files
- Isolation needed to prevent one agent's changes from breaking another's build

## Setup

### Creating a Worktree

```bash
# From the main repo directory
git worktree add .claude/worktrees/agent-{name}-{task-slug} -b worktree-agent-{name}-{task-slug}

# The agent works in:
cd .claude/worktrees/agent-{name}-{task-slug}
```

### Agent Prompt Addition

When spawning a sub-agent with worktree isolation, include in the prompt:

```
You are working in a git worktree at: .claude/worktrees/agent-{name}-{task-slug}
Your branch: worktree-agent-{name}-{task-slug}
Base branch: {project-branch}

All your work happens in this worktree. Do NOT modify files in the main repo directory.
Commit your changes to your worktree branch. The lead agent will merge them.
```

## Merging

### After Agent Completes

The lead agent merges worktree branches back into the project branch:

```bash
# From the main repo directory, on the project branch
git merge worktree-agent-{name}-{task-slug} --no-ff -m "Merge {agent-name}: {task-title}"
```

### Conflict Resolution

If merge conflicts occur:

1. **Do NOT auto-resolve.** Report the conflicting files.
2. Read both versions to understand the intent.
3. Resolve manually, preserving both agents' work.
4. Run verification after resolution: `pnpm type-check && pnpm build && pnpm test`

## Cleanup

### After Merging

Always clean up worktrees after merging to prevent accumulation:

```bash
# Remove the worktree directory
git worktree remove .claude/worktrees/agent-{name}-{task-slug}

# Delete the worktree branch (it's been merged)
git branch -d worktree-agent-{name}-{task-slug}

# Prune any stale worktree references
git worktree prune
```

### Bulk Cleanup (MANDATORY between sprints)

This step is non-negotiable. Stale worktrees are the #1 cause of "dirty worktree" errors, branch conflicts, and disk bloat. Run this after EVERY sprint, not just when problems appear.

```bash
MAIN_WD=$(git rev-parse --show-toplevel)
# Remove ALL non-main worktrees — not just "agent-" prefixed ones
git worktree list --porcelain | grep "^worktree " | sed 's/^worktree //' | while read -r wt; do
  [ "$wt" = "$MAIN_WD" ] && continue
  WT_BRANCH=$(cd "$wt" && git branch --show-current 2>/dev/null)
  git worktree remove "$wt" --force 2>/dev/null && echo "Removed worktree: $wt"
  # Delete the temporary worktree branch (it should already be merged)
  [ -n "$WT_BRANCH" ] && git branch -d "$WT_BRANCH" 2>/dev/null && echo "Deleted branch: $WT_BRANCH"
done
git worktree prune

# Verify — should show only the main working directory
REMAINING=$(git worktree list | wc -l)
[ "$REMAINING" -gt 1 ] && echo "WARNING: $((REMAINING - 1)) worktrees still exist after cleanup!"
```

## Best Practices

- **One worktree per agent per task.** Don't reuse worktrees across tasks.
- **Clean up IMMEDIATELY after merging.** This is the most important rule. Stale worktrees cause cascading problems: dirty worktree errors, branch name collisions, nested `.claude/worktrees/` paths, and disk bloat.
- **Never nest worktrees.** Worktrees should be at `.claude/worktrees/`, not inside other worktrees.
- **Merge between sprints.** Don't let worktree branches diverge across sprints.
- **Run verification after every merge.** Worktree merges can introduce subtle conflicts.
- **Delete worktree branches after merge.** The branch served its purpose — keeping it around causes `git branch` clutter and naming collisions on the next run.

## Common Issues

### Worktree Already Exists

```bash
# If the worktree path already exists
git worktree remove .claude/worktrees/agent-{name} 2>/dev/null
git worktree add .claude/worktrees/agent-{name} -b worktree-agent-{name}
```

### Stale Worktree References

```bash
# Clean up references to worktrees that no longer exist on disk
git worktree prune
```

### Branch Already Exists

```bash
# If the branch exists from a previous run
git branch -D worktree-agent-{name}-{task-slug}
git worktree add .claude/worktrees/agent-{name}-{task-slug} -b worktree-agent-{name}-{task-slug}
```
