# Git Worktree Quick Reference for Agents

## TL;DR: When to Use Worktrees

- **Multiple agents working in parallel** -> Use worktrees (each gets own branch)
- **Single developer/agent** -> Branch switching is fine
- **AFK sessions with multiple tasks** -> Use worktrees (task isolation)

---

## For the Lead Agent

### Spawn Sub-Agents

```typescript
Agent {
  name: "writer-prd",              // Agent name
  isolation: "worktree",           // Auto-creates worktree
  prompt: "Task description..."
}
```

### Merge After Completion

```bash
git fetch origin
git merge --no-ff origin/writer-prd -m "Merge PRD updates"
git branch -d writer-prd
git worktree remove .claude/worktrees/writer-prd
```

---

## For Sub-Agents

### You Auto-Enter a Worktree

When spawned with `isolation: "worktree"`, your first turn happens inside a fresh worktree:

```bash
$ pwd
{{HOME}}/your-project/.claude/worktrees/writer-prd

$ git branch
* writer-prd    # Your isolated branch
  main
```

### Workflow

1. **Claim task**

   ```bash
   pnpm task claim <task-id> --agent <your-agent-id>
   ```

2. **Do work** (only modify relevant files)

3. **Commit**

   ```bash
   git commit -m "Your change summary"
   ```

4. **Complete task**

   ```bash
   pnpm task complete <task-id> --agent <your-agent-id>
   ```

5. **Return to lead agent** — worktree path and branch name are auto-reported

---

## Golden Rules

| Rule                                      | Why                                                 |
| ----------------------------------------- | --------------------------------------------------- |
| **Each agent gets unique branch**         | Git can't checkout same branch in 2 worktrees       |
| **Only lead agent modifies package.json** | Prevents pnpm-lock.yaml conflicts                   |
| **Commit before exiting**                 | Uncommitted changes vanish when worktree is removed |
| **Lead agent merges (not sub-agents)**    | Prevents deploy queue overload                      |
| **Use descriptive names**                 | `writer-prd`, `reviewer-types`, not `agent-1`       |

---

## If Things Go Wrong

| Problem                                     | Fix                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| "fatal: unable to create '.git/index.lock'" | `rm -f .git/index.lock` in that worktree                                                 |
| Branch already exists                       | Use unique branch name: `writer-prd` vs `reviewer-types`                                 |
| Stale worktree references                   | `git worktree prune` then `git worktree list`                                            |
| Forgot to commit                            | If worktree still exists: `git status`, then `git commit`. If deleted: changes are gone. |
| `node_modules` corrupted                    | Only lead agent modifies package.json; agents use `--frozen-lockfile` if needed          |

---

## Pane Navigation in tmux

```
Alt+Left    -> Lead agent's pane
Alt+Right   -> Sub-agent pane (or next pane)
Alt+Up      -> Up pane
Alt+Down    -> Down pane
```

---

## Full Reference

See `README-WORKTREES.md` and `WORKTREE-VISUAL-GUIDE.md` in this directory for more on:

- How worktrees work under the hood
- Parallel merge strategies
- Lock file mechanics
- pnpm/node_modules best practices
