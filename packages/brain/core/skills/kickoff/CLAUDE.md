---
name: kickoff
description: 'Resume from /handoff state (no args) or prime context for a specific task/project. Loads handoff state, task details, PRD, dependencies, git history, memories, and key files.'
user_invocable: true
---

# /kickoff — Context Priming for Task or Project

Load all relevant context in one shot so you're ready to work immediately.

## Arguments

`/kickoff` — resume from last `/pre-compact` handoff (the default post-compact flow)
`/kickoff <project name | task ID | natural language>` — prime context for a specific target

---

## Step 0: Check for Handoff (no arguments)

If invoked with **no arguments**, this is a post-compact resume. Load the handoff:

```bash
cat ~/.claude/state/handoff-latest.md 2>/dev/null
```

If the handoff file exists:

1. **Read the full handoff** — this is your session state from before compaction
2. **Restore git state** — check out the branch listed in `## Git State`, verify uncommitted changes
3. **Load active tasks** — fetch current status of every task in the `## Active Tasks` table from Supabase
4. **Load "Context to Preserve"** — these are non-obvious facts (API patterns, file locations, gotchas) that would otherwise be lost
5. **Load "Key Decisions"** — these prevent you from re-debating settled questions
6. **Present the restored briefing** (see Step 6 format below), including:
   - What we were doing (from `## Last Request`)
   - What's next (from `## Next Steps`)
   - Any blockers (from `## Blockers / Open Questions`)
   - Active task status (re-fetched from Supabase for freshness)
7. **Offer to continue** — "Pick up from Next Steps, or redirect?"

If no handoff file exists, fall back to querying Supabase for available tasks (show in_progress first, then assigned, then inbox top 5) and ask which to kick off.

**Skip to Step 6** after loading handoff — Steps 1-5 are for targeted kickoff only.

---

## Step 1: Resolve Target (with arguments)

Parse the argument:

- **UUID** → query Supabase tasks first, then projects
- **Project name** → fuzzy match against active projects
- **Natural language** → search tasks by title/description

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
    "Prefer": "return=representation",
}
```

Determine: **task mode** (single task) or **project mode** (full project context).

## Step 2: Load Task Context

For the target task (or first unclaimed task in project):

1. **Task details** — title, description, status, priority, assignee, effort
2. **Project PRD** — if task has `project_id`, fetch `prd_content` from the project
3. **Dependency chain** — what tasks are done (context), what's blocked on this task
4. **Task outcome history** — completed sibling tasks and their outcomes (what's already built)

```python
# Fetch task + project in one query
task_url = f"{SUPABASE_URL}/rest/v1/tasks?id=eq.{task_id}&select=*,projects(name,description,prd_content,metadata)"
```

## Step 3: Load Code Context

1. **Recent git log** for files mentioned in the task description:
   ```bash
   git log --oneline -10 -- <mentioned_files>
   ```
2. **Key file paths** — extract file paths from `## Approach` section of task description
3. **Branch status** — current branch, uncommitted changes, relationship to main

## Step 4: Load Memory Context

Query agent memory for project-tagged entries:

```python
# Search memories related to this project/task
memory_url = f"{SUPABASE_URL}/rest/v1/rpc/match_memories"
payload = {
    "query_text": f"{project_name} {task_title}",
    "match_count": 5,
    "workspace_id": WORKSPACE_ID
}
```

Also load:

- Project-specific CLAUDE.md if it exists (`.claude/context/<project-slug>.md`)
- Relevant memory files from `~/.claude/projects/*/memory/`

## Step 5: Load Sprint Context

If in project mode:

1. **Sprint overview** — which sprint we're on, what's done, what's next
2. **Active blockers** — any tasks marked blocked
3. **Progress log** — if `progress.md` exists for this project, load recent entries

## Step 6: Present Context Summary

Format as a structured briefing:

```markdown
## Kickoff: {task_title}

**Project:** {project_name} ({project_status})
**Task:** {task_title} — {effort} effort, {priority} priority
**Sprint:** {current_sprint} of {total_sprints}
**Branch:** {branch_name}

### What You're Building

{task description — ## What section}

### Approach

{task description — ## Approach section}

### What's Already Done

{completed sibling tasks with outcomes}

### Key Files

{file paths from task + recent git activity}

### Relevant Memories

{matched memories — decisions, preferences, patterns}

### Dependencies

- **Blocked by:** {upstream tasks, all done or list blockers}
- **Blocks:** {downstream tasks waiting on this}

### Next Steps

1. {first implementation step from approach}
2. ...
```

## Step 7: Optional — Claim Task

If the target task is `inbox` or `assigned`, ask:

> Ready to claim this task and start working? (y/n)

If yes, update status to `in_progress`:

```python
req = urllib.request.Request(
    f"{SUPABASE_URL}/rest/v1/tasks?id=eq.{task_id}",
    data=json.dumps({"status": "in_progress", "assignee": "rick"}).encode(),
    headers={**headers, "Prefer": "return=minimal"},
    method="PATCH"
)
urllib.request.urlopen(req, timeout=10)
```

## Conventions

- Keep the briefing concise — context, not noise
- If PRD is long, summarize the relevant sections only
- If no memories match, skip that section (don't show empty)
- If task has no project, skip project-level sections
- Works for any task status — use on `in_progress` tasks to re-prime after compaction
- **The primary flow is `/pre-compact` → `/compact` → `/kickoff`** — no-args kickoff is the expected default after compaction
- Handoff context is authoritative — trust "Key Decisions" and "Context to Preserve" sections as ground truth from the previous session
- Re-fetch task statuses from Supabase (handoff may be stale if time has passed between sessions)
- After presenting the handoff briefing, do NOT re-read files listed in "Files Modified" unless actively needed for the next task
