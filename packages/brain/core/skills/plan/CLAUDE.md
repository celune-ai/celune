---
name: plan
description: 'Create a detailed implementation spec before coding. Opt-in two-pass plan/execute workflow — review the strategy before your agent starts building.'
user_invocable: true
---

# /plan — Implementation Planning Before Execution

Create a structured implementation spec for review before committing to code.

## Arguments

`/plan <task-id | task description | "this" (current task)>`

---

## Step 1: Resolve Target

Parse the argument:

- **UUID / prefix** → fetch task from Supabase
- **"this"** → use the currently active task (most recent `in_progress`)
- **Description** → treat as ad-hoc planning request (no task link)

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
```

## Step 2: Research Phase

Before planning, gather context:

1. **Task description** — `## What` and `## Approach` sections
2. **Project PRD** — if task has a project, load relevant PRD sections
3. **Existing code** — use Explore agent to scan files mentioned in the task
4. **Dependencies** — what's already built (completed sibling tasks + outcomes)

For complex tasks (L/XL effort), spawn an Explore agent:

```
Agent(subagent_type="Explore", prompt="Research the codebase for: {task context}.
Find: existing patterns, relevant files, potential conflicts.")
```

## Step 3: Generate Implementation Spec

Write a structured plan:

```markdown
# Implementation Plan: {task_title}

**Task:** {id_prefix} | **Effort:** {effort} | **Sprint:** {sprint}
**Generated:** {timestamp}

## Goal

{1-2 sentences — what this delivers and why it matters}

## Approach

{Chosen strategy — which of the possible approaches and why}

### Alternative Approaches Considered

{If applicable — briefly note what was rejected and why}

## Files to Modify

| File   | Change              | Why      |
| ------ | ------------------- | -------- |
| {path} | {add/modify/delete} | {reason} |

## Implementation Steps

1. {Step 1 — specific, actionable}
   - Detail: {sub-step if needed}
2. {Step 2}
3. ...

## Validation Criteria

- [ ] {How to verify step 1 worked}
- [ ] {How to verify step 2 worked}
- [ ] {Final acceptance criteria}

## Risks & Edge Cases

- {Risk 1 — what could go wrong and mitigation}
- {Edge case — how to handle it}

## Dependencies

- **Needs:** {what must exist before starting}
- **Produces:** {what downstream tasks can use}
```

## Step 4: Save Spec

Save the plan as a project artifact:

```bash
# Save to .claude/plans/ directory
PLAN_DIR="$HOME/.claude/plans"
mkdir -p "$PLAN_DIR"
# Filename: {task-id-prefix}-{slugified-title}.md
```

If task has a `project_id`, also note the plan file path in the task metadata.

## Step 5: Present for Review

Show the plan to the user with action options:

> **Plan ready for: {task_title}**
>
> Saved to `~/.claude/plans/{filename}.md`
>
> **Actions:**
>
> - **"go"** or **"approve"** → start implementing from this plan
> - **"edit"** → modify the plan before executing
> - **"skip"** → discard plan and freestyle

If the user approves, the plan is loaded as context for implementation. The agent follows the implementation steps in order.

## Workspace Setting: Auto-Plan

This is an opt-in workspace setting. When enabled, `/build` automatically runs `/plan` for L/XL effort tasks.

**Setting:** `plan_before_execute` (boolean, default: `false`)

When OFF (default): `/build` runs tasks directly — current freestyle behavior.
When ON: `/build` pauses before L/XL tasks, generates a plan, and waits for approval.

Per-task override: `/plan this` forces planning on any task regardless of setting.
Per-build override: `/build --plan <project-id>` enables it for one project run.

## Smart Suggestion (Non-Blocking)

Even when the setting is OFF, `/build` may suggest planning for XL tasks:

> This task is XL effort. Want to `/plan` first? (y/n, default: n)

This is a one-line prompt, not a blocker. Default is no — respects the freestyle preference.

## Conventions

- Plans should be actionable, not theoretical — specific files, specific steps
- Keep plans under 80 lines — enough detail to execute, not a novel
- "Files to Modify" is the most important section — it prevents scope creep
- "Validation Criteria" must be testable, not vague ("works correctly" → "returns 200 on valid input")
- Plans are disposable — they inform execution, they don't constrain it
- If the task is S/M effort, the plan should be proportionally simple (skip alternatives, risks)
