---
name: todays-project
description: 'Generate prioritized daily task list from Supabase planned/inbox tasks.'
user_invocable: true
---

# Today's Project

Generate a prioritized, sequenced daily task list by pulling from Supabase, checking yesterday's carryovers, and triaging the inbox.

## Workflow

### Step 0: Check for initiated tasks

List the workspace tasks in `inbox` and `planning` with the Celune MCP `list_tasks` tool. Tasks the user started from the web app with the Initiate button are **top priority** — the user explicitly kicked them off. Add them to the top of today's plan and claim them first.

### Step 1: Check for existing daily plan

Read `01-daily/YYYY-MM-DD-projects.md` (today's date) in the vault.

```bash
cat $VAULT_ROOT/01-daily/$(date +%Y-%m-%d)-projects.md 2>/dev/null
```

- If it exists and has tasks, present it and ask the user if they want to refresh or continue from it.
- If it doesn't exist, proceed to Step 2.

### Step 2: Check yesterday's plan for carryovers

Read yesterday's plan file:

```bash
cat $VAULT_ROOT/01-daily/$(date -v-1d +%Y-%m-%d)-projects.md 2>/dev/null
```

Note any tasks marked incomplete, deferred, or still in progress. These carry forward automatically.

### Step 3: Pull tasks from Supabase

Fetch all active tasks:

```python
import sys
sys.path.insert(0, "$VAULT_ROOT/scripts")
from task_client import make_client

client = make_client()
# Pull all non-done tasks
for status in ["inbox", "in_progress", "assigned", "planning", "backlog"]:
    tasks = client.list_tasks(status=status)
    # Process each bucket
```

Include each task's `category` tags (if present) in the Notes column of the Progress Tracker as `[tag1, tag2]`. This makes the daily plan aware of which tags map to which tasks, enabling task reconciliation during work sessions.

Relevant statuses and what they mean:

- **in_progress** — actively being worked on (highest priority, finish these first)
- **assigned** — committed to but not started
- **planning** — needs breakdown before work starts
- **inbox** — untriaged, needs review and decision (process/defer/archive)
- **backlog** — parked for later, only pull if relevant to today's focus

### Step 4: Prioritize and sequence

Apply this priority order:

1. **Carry-forwards** from yesterday (incomplete items get top billing)
2. **In-progress tasks** (finish what's started before starting new)
3. **Assigned/planning tasks** (committed work)
4. **High-relevance inbox items** (triage: promote, defer, or archive)
5. **Backlog items** only if they connect to today's theme

Sequencing rules:

- Group related tasks together (same project or system)
- Put quick wins (< 15 min) early for momentum
- Put deep work in the middle block
- Put review/triage at the end
- Cap the list at 5-8 tasks (realistic for one day)

### Step 5: Present to the user

Present the plan as a **Progress Tracker table**. This is the primary UI for the daily plan. Group tasks by phase/theme:

```markdown
## Progress Tracker

| #   | Phase   | Task    | Effort | Status  | Notes                        |
| --- | ------- | ------- | ------ | ------- | ---------------------------- |
| 1   | {phase} | {title} | S      | done    | [tag1, tag2] {what was done} |
| 2   | {phase} | {title} | M      | pending | [tag1] {context}             |

...
```

**Effort:** S = Small (<15 min), M = Medium (15-60 min), L = Large (1+ hours)
**Status:** `pending`, `in progress`, `done`, `deferred`, `blocked`

End with:

- **Inbox triage summary**: how many inbox items reviewed, how many deferred
- **Deferred items**: anything explicitly pushed to tomorrow

Update this table as tasks are completed during the session. When the user asks to "pull up the list," show this table with current statuses.

### Step 6: Save to vault

Write to `01-daily/YYYY-MM-DD-projects.md`:

```markdown
# Daily Project Plan — {date}

_Generated at {time}_

## Today's Focus

{1-sentence theme for the day}

## Progress Tracker

| #   | Phase   | Task    | Effort | Status  | Notes              |
| --- | ------- | ------- | ------ | ------- | ------------------ |
| 1   | {phase} | {title} | S/M/L  | pending | {context or notes} |

...

**Legend:** S = Small, M = Medium, L = Large

## Inbox Triage

- {n} items reviewed
- {n} promoted to today's list
- {n} deferred to backlog
- {n} archived/done

## Carried Forward

- {items from yesterday, if any}

## Deferred (not today)

- {parked items}

---

_Updated: {timestamp}_
```

### Step 7: Update task statuses

For tasks promoted from inbox to today's list, update their Supabase status:

```python
client.update_task(task_id, status="scoping", assignee="<your handle>")
```

For tasks explicitly deferred, leave as-is (inbox or backlog).

## Prioritization Reference

See [references/prioritization.md](references/prioritization.md) for the full prioritization framework including the $1k break-even lens, urgency/impact matrix, and project grouping rules.
