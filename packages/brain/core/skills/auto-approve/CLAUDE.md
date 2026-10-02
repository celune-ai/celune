---
name: auto-approve
description: 'Toggle auto-approve for PR self-review on non-main branches.'
user_invocable: true
---

# /auto-approve — Autonomous Execution Mode

Scoped, safe alternative to `--dangerously-skip-permissions`. Free-running execution within guardrails.

## Arguments

- `/auto-approve` — full platform scope with standard guardrails
- `/auto-approve code-only` — no git push, no Slack, no Supabase mutations
- `/auto-approve this task` — scoped to current task files only

## On Invocation

### Step 1: Pre-flight Safety Scan

**Read refs/scripts.md for the pre-flight scan script.**
If CRITICAL issue found, do NOT activate. If only WARNINGs, report and proceed.

### Step 2: Permission Sync Check

**Read refs/scripts.md for the permission sync script.**
Verify `~/.claude/settings.json` has blanket `Bash` in allow + destructive commands in deny.

### Step 3: Activate Mode

**Read refs/scripts.md for activation/timeout scripts.**
Set behavioral flag. Default timeout: 2 hours. Check periodically.

### Step 4: Confirm Scope

Announce: mode, pre-flight results, permissions summary, scope. Say "stop auto-approve" to return.

## Rules of Engagement

**Read refs/rules.md for the full ALWAYS DO / NEVER DO / PAUSE AND CONFIRM lists.**

Key guardrails:

- ALWAYS: edit code, run builds/tests, git operations on feature branches, task system, Supabase MCP
- NEVER: force push, push to main, `rm -rf` source, drop tables, `sudo`, merge PRs to main
- PAUSE: 3+ repeated failures, 300+ line blast radius, ambiguous scope, secrets detected, merge conflicts

## Progress Checkpoints (AFK sessions)

**Read refs/scripts.md for checkpoint log format and scripts.**
Write progress after each task to `memory/overnight/progress-{date}.md`. Summary every 3 tasks or 2 hours.

## Integration

Other skills activate auto-approve by referencing this skill. Used by: `/afk-building`, `/afk-housekeeping`, `/afk-nightwatch`, `/afk-learning`, `/afk-planning`, `/deep-build`.

## Deactivation

Ends on: the user says stop, session ends, hard stop, circuit breaker, timeout. Remove `/tmp/auto_approve_active` and announce.
