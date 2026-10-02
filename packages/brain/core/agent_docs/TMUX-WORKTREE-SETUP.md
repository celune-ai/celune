# Tmux + Git Worktree Setup for Parallel Agent Work

## Visual Layout

```
+----------------------------------+----------------------------------+
|                                  |                                  |
|                                  |                                  |
|     LEAD (main)                  |     AGENT-1 (agent-1-prd)       |
|                                  |                                  |
|  /repo                           |  /repo/.claude/worktrees/agent-1 |
|  * main                          |  * agent-1-prd                   |
|                                  |    main                          |
|                                  |                                  |
+----------------------------------+----------------------------------+
|                                  |                                  |
|                                  |                                  |
|     [merge staging]              |     AGENT-2 (agent-2-types)      |
|                                  |                                  |
|  Commands here after agents      |  /repo/.claude/worktrees/agent-2 |
|  finish                          |  * agent-2-types                 |
|                                  |    main                          |
|                                  |                                  |
+----------------------------------+----------------------------------+
```

**Pane Navigation:**

```
Alt+Left   -> Lead (main)
Alt+Right  -> Agent-1 or Agent-2
Alt+Up     -> Switch vertically
Alt+Down   -> Switch vertically
```

---

## Setup Commands

### Manually Create Session

```bash
# Create new tmux session
tmux new-session -s platform -x 240 -y 60

# Split vertically (left 50%, right 50%)
tmux split-window -h -p 50

# Split right pane horizontally (top 50%, bottom 50%)
tmux split-window -v -p 50

# Now you have 3 panes:
# 0 (left)       = Lead
# 1 (top-right)  = Agent-1
# 2 (bot-right)  = Agent-2
```

### Attach to Existing Session

```bash
tmux attach -t platform
```

### Kill Session

```bash
tmux kill-session -t platform
```

---

## Per-Pane Setup

After splitting, set clear PS1 prompts in each pane so you never forget which agent you're in.

### Pane 0 (Lead):

```bash
# In the lead agent's pane
export PS1="[LEAD main] $ "
cd {{HOME}}/your-project
```

### Pane 1 (Agent-1):

```bash
# In Agent-1's pane (will be auto-created by Claude Code)
# But if manual: git worktree add .claude/worktrees/agent-1-prd -b agent-1-prd
export PS1="[AGENT-1 prd] $ "
cd {{HOME}}/your-project/.claude/worktrees/agent-1-prd
```

### Pane 2 (Agent-2):

```bash
# In Agent-2's pane
# git worktree add .claude/worktrees/agent-2-types -b agent-2-types
export PS1="[AGENT-2 types] $ "
cd {{HOME}}/your-project/.claude/worktrees/agent-2-types
```

---

## Workflow in Tmux

### Step 1: Lead in Pane 0 — Create Tasks

```bash
[LEAD main] $ pnpm task create "Rewrite auth PRD" \
  --description "## What\n..." \
  --tags "prd,auth"
```

### Step 2: Lead in Pane 0 — Spawn Agents

In Claude Code:

```typescript
Agent { name: "agent-1-prd", isolation: "worktree", prompt: "..." }
Agent { name: "agent-2-types", isolation: "worktree", prompt: "..." }
```

Claude Code spawns them. They auto-enter worktrees.

### Step 3: Agent-1 in Pane 1 — Work & Commit

```bash
[AGENT-1 prd] $ pnpm task claim task-123 --agent agent-1
# ... do work ...
[AGENT-1 prd] $ git commit -m "Update auth PRD with new flow diagrams"
[AGENT-1 prd] $ pnpm task complete task-123 --agent agent-1
# Report back to lead
```

### Step 4: Agent-2 in Pane 2 — Work & Commit (in parallel)

```bash
[AGENT-2 types] $ pnpm task claim task-124 --agent agent-2
# ... do work ...
[AGENT-2 types] $ git commit -m "Add AuthFlow and PermissionSet types"
[AGENT-2 types] $ pnpm task complete task-124 --agent agent-2
# Report back to lead
```

### Step 5: Lead in Pane 0 — Review & Merge

```bash
[LEAD main] $ git fetch origin

[LEAD main] $ git log --oneline origin/agent-1-prd ^main
abcd123 Update auth PRD with new flow diagrams

[LEAD main] $ git log --oneline origin/agent-2-types ^main
def4567 Add AuthFlow and PermissionSet types

[LEAD main] $ git merge --no-ff origin/agent-1-prd -m "Merge auth PRD"
[LEAD main] $ git merge --no-ff origin/agent-2-types -m "Merge auth types"

[LEAD main] $ pnpm test
[LEAD main] $ git push origin main
```

---

## Monitoring Workflow

### Pane 0: Watch Kanban in Browser

While agents work, the lead can:

1. Open admin UI at `http://localhost:3002`
2. Navigate to Tasks kanban
3. Watch cards move from "Assigned" -> "In Progress" -> "Done" in real-time (via SSE)

### Pane 1 & 2: Independent Work

Each agent works in their own pane, sees their own `git branch`, modifies different files — zero conflicts.

---

## Troubleshooting in Tmux

### Agent Lost Connection

```bash
# In lead's pane, check if worktree still exists
git worktree list

# If orphaned, prune
git worktree prune
```

### One Agent Blocked

```bash
# In that agent's pane
pnpm task block <task-id> --reason "Waiting for API key" --agent <name>

# Lead sees red badge in kanban, can help
```

### All Agents Done, Ready to Merge

```bash
# In lead's pane
git fetch origin
git branch -avv  # shows all branches and their remote tracking

# Review both branches
git log --oneline origin/agent-1-prd ^main
git log --oneline origin/agent-2-types ^main

# Merge
git merge --no-ff origin/agent-1-prd
git merge --no-ff origin/agent-2-types

# Clean up
git worktree remove .claude/worktrees/agent-1-prd
git worktree remove .claude/worktrees/agent-2-types
git worktree list  # should only show main
```

---

## Quick Commands Cheat Sheet

### Git Worktree

```bash
git worktree list              # See all active worktrees
git worktree add <path> -b <branch>  # Create manually
git worktree remove <path>     # Remove after merge
git worktree prune             # Clean stale refs
git worktree lock <path>       # Lock from deletion
git worktree unlock <path>     # Unlock
```

### Tmux Pane Control

```bash
Alt+Left/Right/Up/Down  # Switch panes
Ctrl+B %                # Split horizontal
Ctrl+B "                # Split vertical
Ctrl+B X                # Kill pane
tmux kill-session -t platform  # Kill entire session
```

### Task Management

```bash
pnpm task claim <id> --agent <name>
pnpm task block <id> --reason "..." --agent <name>
pnpm task unblock <id>
pnpm task complete <id> --agent <name>
```

---

## One-Liner Setup

If you want to script it:

```bash
#!/bin/bash
REPO={{HOME}}/your-project
SESSION=platform

tmux new-session -d -s $SESSION -x 240 -y 60 -c $REPO
tmux split-window -h -p 50 -t $SESSION:0 -c $REPO
tmux split-window -v -p 50 -t $SESSION:0.1 -c $REPO

# Set prompts
tmux send-keys -t $SESSION:0.0 "export PS1='[LEAD main] $ '" Enter
tmux send-keys -t $SESSION:0.1 "export PS1='[AGENT-1] $ '" Enter
tmux send-keys -t $SESSION:0.2 "export PS1='[AGENT-2] $ '" Enter

tmux attach -t $SESSION
```

Save as `scripts/init-parallel-session.sh`, then:

```bash
bash scripts/init-parallel-session.sh
```

---

## Summary

1. Create 3-pane tmux session (Lead + 2 agents)
2. Set distinctive PS1 prompts in each pane
3. Lead spawns agents with `isolation: "worktree"`
4. Agents auto-enter their worktrees in Claude Code
5. Watch kanban in browser for real-time progress
6. Lead merges branches after agents complete
7. Clean up worktrees with `git worktree remove`

That's parallel AI agent work at scale.
