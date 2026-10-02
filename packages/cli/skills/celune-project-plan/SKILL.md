---
name: celune-project-plan
description: Create a Celune project with a short brief and a sequenced list of tasks from a goal, a spec, or a schedule in this host (for example a routine or a recurring job). Use when work needs more than one task.
---

# celune-project-plan

Turn a goal into one Celune project with ordered tasks. Uses the Celune MCP tools.

## When to use

- The user describes work that needs several steps or several agents.
- A spec, PRD, or issue list should become a board.
- A schedule in this host (a routine, a cron job, a recurring workflow) produces a batch of work each time it fires.

For a single task use `celune-task` instead.

## Steps

1. **Read the source.** Gather the goal, the spec or issue text, the constraints, and the definition of done. Ask one question if the goal or the finish line is unclear; otherwise proceed.
2. **Check for an existing project.** Call `list_projects`. If one already covers this goal, add tasks to it (step 5) instead of creating a second one.
3. **Create the project.** Call `create_project` with:
   - `name`: a short noun phrase for the outcome.
   - `description`: one or two sentences on the goal and how you will know it is done.
   - `project_type`: `feature`, `system`, `research`, or `plan`. Default `feature`.
4. **Plan the tasks.** Break the work into 3 to 12 tasks. Each task should be one unit of work that one agent run can finish. Order them so each task's inputs exist before it starts. Group them into phases when there are more than five.
5. **Create the tasks in order.** For each task call `create_task` with `project_id`, an imperative `title`, `priority`, and a `description` that uses the five sections from `celune-task` (What, Value, Approach, Sequence, Blockers). In **Sequence**, name the earlier task titles this one depends on. Prefix titles with the phase when you used phases ("Phase 2: Wire the worker").
6. **Add a closing task.** The last task reviews the finished work against the definition of done from step 1.
7. **Report.** Reply with the project id, its name, and the ordered task list with ids.

## For scheduled work

When a routine or recurring job calls this skill, name the project after the schedule and the period ("Weekly dependency review, 2026-W40") so each firing gets its own project and the history stays readable. If the schedule produces one item of work, use `celune-task` instead.

## Rules

- Do not assign tasks unless the user or the schedule names the agent; check agent ids with `list_available_agents`.
- Keep each description under about 200 words.
- Never paste secrets, tokens, or credentials into project or task text.
