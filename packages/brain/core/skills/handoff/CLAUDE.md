---
name: handoff
description: 'Save a structured handoff snapshot before compacting or ending a session. Captures decisions, files modified, blockers, and next steps for seamless continuity.'
user_invocable: true
---

# /handoff — Structured Session Handoff

Save session state in a format optimized for post-compact recovery or AFK pickup.

## Arguments

`/handoff` (no arguments — captures current session state)

---

## Step 1: Gather Session State

Collect from the current session:

### 1a. Active Work

```bash
# Current branch and uncommitted changes
git status --short
git branch --show-current
git log --oneline -5
```

### 1b. Task State

Query Supabase for tasks touched this session (in_progress or recently completed):

```python
import json, urllib.request, os

env_file = "$CELUNE_REPO/apps/admin/.env.local"
SUPABASE_URL = SUPABASE_KEY = ""
with open(env_file) as f:
    for line in f:
        if line.startswith("NEXT_PUBLIC_SUPABASE_URL="):
            SUPABASE_URL = line.split("=", 1)[1].strip()
        elif line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
            SUPABASE_KEY = line.split("=", 1)[1].strip()

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

# Fetch in-progress tasks
req = urllib.request.Request(
    f"{SUPABASE_URL}/rest/v1/tasks?status=eq.in_progress&select=id,title,project_id,metadata",
    headers={**headers, "Prefer": ""},
)
resp = urllib.request.urlopen(req, timeout=10)
active_tasks = json.loads(resp.read().decode())
```

### 1c. Files Modified

```bash
# All files changed on this branch vs origin/main
git diff --name-only origin/main...HEAD
# Plus uncommitted
git diff --name-only
git diff --name-only --cached
```

## Step 2: Build Handoff Document

Write to `~/.claude/state/handoff-latest.md`:

```markdown
# Handoff — {YYYY-MM-DD HH:MM}

## Last Request

{The most recent user request or directive — what were we doing?}

## Active Tasks

| ID (prefix) | Title   | Status   | Project                        |
| ----------- | ------- | -------- | ------------------------------ |
| {8-char}    | {title} | {status} | {project_name or "standalone"} |

## Key Decisions This Session

- {Decision 1 — what was decided and why}
- {Decision 2}

## Files Modified

{git diff --name-only output, grouped by directory}

## Blockers / Open Questions

- {Anything unresolved that needs the user's input}
- {Or "None"}

## Next Steps

1. {What should happen next — the immediate next action}
2. {Follow-up actions}

## Git State

- **Branch:** {branch_name}
- **Uncommitted changes:** {yes/no — summary if yes}
- **Commits ahead of main:** {N}

## Context to Preserve

{Any important context that would be lost on compaction — API quirks discovered, failed approaches, key file locations}
```

## Step 3: Also Update Daily Plan (if exists)

If today's daily plan exists at the vault path, update task statuses:

```bash
PLAN_FILE="$VAULT_ROOT/01-daily/$(date +%Y-%m-%d)-projects.md"
if [ -f "$PLAN_FILE" ]; then
    echo "Daily plan exists — update statuses"
fi
```

Update the Progress Tracker table with current statuses and add a `_Updated: {timestamp} (handoff save)_` footer.

## Step 4: Confirm

Output a brief confirmation:

> **Handoff saved.** State at `~/.claude/state/handoff-latest.md`. {N} active tasks, {N} files modified, {N} decisions captured. Safe to `/compact` or start AFK.

## Integration with PreCompact Hook

This skill can optionally be triggered by the `PreCompact` hook for automatic invocation. To enable:

1. Add to `~/.claude/settings.json` under `PreCompact` hooks
2. The hook version should be a lightweight script that calls the essential parts (git state + active tasks)
3. The full `/handoff` skill captures richer context (decisions, next steps) and should be invoked manually for important sessions

## Conventions

- Keep the handoff under 100 lines — concise enough to load post-compact
- "Key Decisions" should include WHY, not just WHAT
- "Context to Preserve" is for non-obvious things — API quirks, failed approaches, workarounds
- Always include the exact branch name and commit count
- If running during a `/build`, include the project ID and current sprint number
