---
name: afk-overnight
description: "Autonomous overnight research and monitoring mode.\n  TRIGGER when: the user says 'afk overnight', 'run overnight', 'monitor overnight', or wants overnight research/monitoring tasks.\n  DO NOT TRIGGER when: feature building (/afk-building), task cleanup (/afk-housekeeping), backlog grooming (/afk-planning)."
user_invocable: true
---

# afk-overnight

Overnight autonomous runner. Two phases:

1. **Task execution** — Works through Planned tasks assigned to the lead agent that don't need the user to unblock. Slower pace than daytime AFK (3-min cooldown vs 1-min).
2. **Research mode** — When tasks run out, switches to feed scrubbing: YouTube, Reddit, X, blogs, and Slack for product ideas, competitive intel, and improvements. Creates inbox tasks for actionable findings.

Runs from 10 PM to 7 AM. The user sends any message to stop and get a summary.

---

## On Invocation (`/afk-overnight`)

### 1. Check if already running

```bash
if [ -f ~/.claude/state/afk_active ]; then
    echo "AFK session already running (PID $(cat ~/.claude/state/afk.pid 2>/dev/null || echo 'unknown'))"
fi
```

If `~/.claude/state/afk_active` exists, tell the user an AFK session is already active and ask if they want to stop it or let it continue. Do not start a second instance.

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

```bash
Bash tool with run_in_background: true
command: {{VAULT_PATH}}/scripts/nightwatch.sh
```

### 3. Confirm to the user

> Overnight mode is on. I'll work through planned tasks first (3-min pace), then switch to research mode when they're done. Runs until 7 AM or until you message me. Sleep well.

---

## On Return (any subsequent message while overnight mode is active)

### 1. Stop the loop

```bash
rm -f ~/.claude/state/afk_active
```

### 2. Read the current mode

```bash
cat /tmp/nightwatch_mode 2>/dev/null || echo "unknown"
```

### 3. Read the log and summarize

**If tasks were completed:**

- Tasks completed (title, branch name, outcome)
- Tasks blocked (title, reason)
- Branches created

**If research was done:**

- Research cycles completed
- Inbox tasks created (titles)
- Key findings / insights

**Always include:**

- Duration (how long the session ran)
- Which phase it was in when stopped

### 4. Clean up temp files

```bash
rm -f ~/.claude/state/afk_active ~/.claude/state/afk.pid ~/.claude/state/afk_log_path /tmp/nightwatch_mode
```

### 5. Respond to the user's message

---

## Environment Variables

| Var                 | Default | Description                             |
| ------------------- | ------- | --------------------------------------- |
| `START_HOUR`        | 22      | Start hour (24h format)                 |
| `STOP_HOUR`         | 7       | Stop hour (24h format)                  |
| `COOLDOWN_SEC`      | 180     | Seconds between tasks (3 min)           |
| `RESEARCH_COOLDOWN` | 300     | Seconds between research cycles (5 min) |
| `MODEL`             | sonnet  | Claude model for sub-invocations        |

## Research Topics (Phase 2 rotation)

1. **YouTube** — AI agent workflows, task management, dev productivity, design systems
2. **Reddit** — r/webdev, r/nextjs, r/SaaS, r/selfhosted, r/ProductManagement pain points
3. **X/Twitter + blogs** — AI dev tools, autonomous agents, indie SaaS trends
4. **Product launches** — What's resonating with users in the space
5. **Backlog grooming** — Stale tasks, duplicates, missing descriptions, priority calibration

Each cycle creates inbox tasks for actionable findings (quality over quantity — 2-3 high-signal tasks per cycle).

## Guardrails

- Research mode is **read-only** — no code edits, no vault modifications
- Task mode follows same rules as `/afk-housekeeping` — branch per task, no push to main
- Shares the `~/.claude/state/afk_active` sentinel with other AFK skills — only one can run at a time
- **Timeout:** Default 4 hours. Check between tasks/research cycles.
