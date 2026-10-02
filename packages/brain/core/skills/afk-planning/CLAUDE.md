---
name: afk-planning
description: 'Autonomous backlog grooming — triages inbox, creates projects, calibrates priorities.'
user_invocable: true
---

# afk-planning

Persistent product manager mode. Runs a repeating cycle of research, analysis, and task refinement instead of executing tasks.

## On Invocation (`/afk-planning`)

### 1. Check for custom instructions

If invoked with arguments, treat as **mission brief** — focus research on specified topics, match requested deliverables, respect pacing instructions. Otherwise run default broad planning cycle.

### 2. Check if already running

```bash
if [ -f ~/.claude/state/afk_active ]; then
    echo "AFK session already running (PID $(cat ~/.claude/state/afk.pid 2>/dev/null || echo 'unknown'))"
fi
```

### 3. Run the planning cycle

Run inline using Task tool. Each cycle 10-15 min, then 5 min cooldown (10-15 min if pacing requested), repeat. Runs until the user messages, 5 PM (daytime) / 7 AM (overnight).

Create sentinel + timeout (4 hours default):

```bash
touch ~/.claude/state/afk_active
echo $$ > ~/.claude/state/afk.pid
date +%s > ~/.claude/state/afk_start_time
echo "14400" > ~/.claude/state/afk_timeout_secs
```

### 4. Confirm to the user

With mission brief: "Planning mode on. Mission: {summary}. Running overnight."
Without: "Planning mode on. Cycling through research, grooming, prioritization. Slack me for specific requests."

## The Planning Cycle

Run phases in order. Repeat until stopped. **Read refs/phases.md for detailed phase instructions.**

1. **External Research** — Scan YouTube, Reddit, X, blogs, Slack for feature ideas and competitive intel
2. **Task Audit** — Pull all open tasks; check description quality, staleness, duplicates, tags, blockers
3. **Project Grouping** — Cluster 3+ related tasks into projects; link via `project_id`
4. **Priority Calibration** — Re-evaluate using Urgent/High/Normal/Low framework through $1k break-even lens
5. **Planning Queue** — Maintain 5-10 tasks in `planning` status, balanced mix of quick wins and deep work
6. **Log and Loop** — Append summary to `memory/sessions/YYYY-MM-DD.md`, cooldown, next cycle

## On Return

1. Remove sentinel: `rm -f ~/.claude/state/afk_active`
2. Summarize: new tasks, updates, projects created, priority changes, key findings
3. Clean up state files
4. Respond to the user's message

## Key Principles

- Agents are primary users — task descriptions must be detailed enough for cold pickup
- Business value first — filter through $1k break-even lens
- Don't create noise — smaller well-groomed backlog > massive unfocused one
- Respect the user's explicit priority decisions — flag disagreements as comments
- Show reasoning for all prioritization changes
