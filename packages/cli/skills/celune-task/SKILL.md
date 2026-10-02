---
name: celune-task
description: Create a Celune task from the current unit of work (a run, a job, a branch, or a request in this session) so it shows on the Celune board. Use when work starts that should be tracked, or when follow-up work is found.
---

# celune-task

Turn the current unit of work into one Celune task. Uses the Celune MCP tools.

## When to use

- A run, job, or session starts work that is not on the board yet.
- You find follow-up work while doing something else.
- The user asks to track, log, or ticket something.

Skip it when the work already has a task. Check first (step 2).

## Steps

1. **Name the unit of work.** Collect what identifies it in this host: the run or job id, the git branch (`git branch --show-current`), the request that started it, and the files or systems it touches.
2. **Check for an existing task.**
   - If there is a git branch, call `find_task_by_branch` with `branch_name`.
   - Otherwise call `list_tasks` and look for a title that matches.
   - If a task exists, report its id and stop. Use `celune-status` to update it.
3. **Pick a project.** Call `list_projects`. Use the project that owns this area of work. If none fits, leave `project_id` empty; do not create a project here (that is `celune-project-plan`).
4. **Write the task.** Call `create_task` with:
   - `title`: an imperative line under 80 characters that says the outcome ("Add retry to webhook delivery").
   - `description`: the five sections below, in Markdown.
   - `priority`: `urgent`, `high`, `normal`, or `low`. Default `normal`.
   - `project_id`: from step 3, when there is one.
   - `status`: leave it unset so the task lands in `inbox`, unless the user asked for another status.
   - `assignee`: only when the user names an agent; check it with `list_available_agents`.
5. **Link the unit of work.** Call `add_comment` on the new task with the run or job id, the branch, and a link to the run in the host UI when there is one.
6. **Report.** Reply with the task id and title.

## Description template

```markdown
## What

One or two sentences on the change or deliverable.

## Value

Who benefits and how.

## Approach

The planned steps or the files and systems involved.

## Sequence

What must happen before this task, if anything.

## Blockers

Known blockers, or "None".
```

## Rules

- One task per unit of work. Split only when the parts can ship on their own.
- Never paste secrets, tokens, or credentials into a title, description, or comment.
- If you are running inside a harness run for another task, create follow-ups with this skill but do not change that run's own task; its status comes from the run result.
