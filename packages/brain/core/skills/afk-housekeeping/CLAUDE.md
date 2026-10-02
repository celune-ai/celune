---
name: afk-housekeeping
description: 'Autonomous housekeeping — works through low-effort planned tasks during AFK periods.'
user_invocable: true
---

# afk-housekeeping

Autonomous background runner for housekeeping tasks: code quality, security fixes, infra improvements, and anything else that doesn't need the user's feedback. The user says `/afk-housekeeping`, Claude works through planned tasks. Any message stops it and triggers a summary.

Tasks are re-queried from Supabase each iteration (sorted by priority), so anything the user creates or reprioritizes via Slack gets picked up on the next cycle.

---

## On Invocation (`/afk-housekeeping`)

### 1. Check if already running

```bash
if [ -f ~/.claude/state/afk_active ]; then
    echo "AFK session already running (PID $(cat ~/.claude/state/afk.pid 2>/dev/null || echo 'unknown'))"
fi
```

If `~/.claude/state/afk_active` exists, tell the user an AFK session is already active and ask if they want to stop it (remove the sentinel) or let it continue. Do not start a second instance.

### 1b. Set up timeout

```bash
date +%s > ~/.claude/state/afk_start_time
echo "14400" > ~/.claude/state/afk_timeout_secs  # 4 hours default
```

The background loop should check timeout between tasks:

```bash
START=$(cat ~/.claude/state/afk_start_time 2>/dev/null || echo 0)
TIMEOUT=$(cat ~/.claude/state/afk_timeout_secs 2>/dev/null || echo 14400)
NOW=$(date +%s)
if [ "$((NOW - START))" -gt "$TIMEOUT" ]; then
  rm -f ~/.claude/state/afk_active
  echo "AFK timeout reached. Shutting down gracefully."
fi
```

### 2. Start the background loop

Run the script in background:

```bash
Bash tool with run_in_background: true
command: $VAULT_ROOT/scripts/afk.sh
```

### 3. Confirm to the user

After starting, respond with something like:

> Housekeeping mode on. Working through planned tasks (1-min gaps, runs until 5 PM). Slack me to reprioritize; I'll pick it up next cycle.

Keep it brief. One or two sentences max.

---

## On Return (any subsequent message while AFK is active)

When the user sends any message and `~/.claude/state/afk_active` exists, this is the return flow. Do this BEFORE responding to whatever the user actually said.

### 1. Stop the loop

```bash
rm -f ~/.claude/state/afk_active
```

The script checks for this file between tasks and will exit cleanly within a minute.

### 2. Wait briefly for the script to finish

Give it a few seconds. The background task notification will arrive, or check:

```bash
# Check if process is still running
kill -0 $(cat ~/.claude/state/afk.pid 2>/dev/null) 2>/dev/null && echo "still running" || echo "stopped"
```

### 3. Read the log and summarize

```bash
LOG_PATH=$(cat ~/.claude/state/afk_log_path 2>/dev/null)
```

Read the log file at that path. Summarize for the user:

- **Tasks completed** (title, branch name, outcome)
- **Tasks blocked** (title, reason)
- **Branches created** (list of `afk/*` branches)
- **Duration** (how long the session ran)

Format as a compact summary, not a wall of text.

### 4. Clean up temp files

```bash
rm -f ~/.claude/state/afk_active ~/.claude/state/afk.pid ~/.claude/state/afk_log_path
```

### 5. Respond to the user's message

After the summary, address whatever the user actually said. If they just said "back" or similar, the summary is enough.

---

## Slack Priority

The AFK loop re-queries Supabase fresh before every task. If the user messages the Slack bot to create a new task or reprioritize an existing one, it lands in Supabase and gets picked up on the next 1-min cycle. No special handling needed; the priority sort in the task query handles it naturally.

## PRD Approval Gate

For any task belonging to a project (`project_id` is set), the housekeeping loop must check the parent project's `prd_metadata.status` before claiming. Only work on tasks from projects where:

- `prd_metadata.status == "approved"`, OR
- `project_type == "research"` (research projects skip the PRD gate), OR
- The task has no `project_id` (standalone tasks are always eligible)

If a task's project PRD is not approved, skip it and log:

```
Skipped "{task_title}" — project "{project_name}" PRD not approved (status: {status}). Use /build to approve.
```

This is enforced in `afk.sh` before each task is claimed. The `/build` skill auto-approves PRDs on explicit invocation — housekeeping NEVER auto-approves.
