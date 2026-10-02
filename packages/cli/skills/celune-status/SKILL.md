---
name: celune-status
description: Report progress and the outcome on the Celune task this session or run has claimed. Use at milestones, when blocked, and when the work is finished.
---

# celune-status

Keep the claimed Celune task current. Uses the Celune MCP tools.

## Find the task

1. Use the task id from the run brief or the user, when there is one.
2. Otherwise call `find_task_by_branch` with the current git branch.
3. Otherwise call `list_tasks` and pick the task assigned to you that is `in_progress`.
4. Call `get_task` to read its status, comments, and `metadata.harness_run`.

If no task is found, say so and offer `celune-task`.

## Decide who owns the status

- **Harness run.** If `metadata.harness_run` exists and its `run_id` is the run you are in, the harness owns the task status. Post progress with `add_comment` only. Do not call `complete_task` or `block_task`: the run result reports success or failure, and calling them as well moves the task twice. End your run with a short summary; it becomes the task outcome.
- **Session.** Otherwise you own the status. Use the steps below.

## Steps

1. **Claim if needed.** If the task is not `in_progress`, call `claim_task` with `task_id`.
2. **Progress.** At each milestone call `add_comment` with what changed, what is next, and links (pull request, run, document). Keep it to three to five lines.
3. **Blocked.** If you cannot continue, call `block_task` with a `reason` that names what is missing and who can provide it.
4. **Done.** When the definition of done in the task description is met, call `complete_task` with an `outcome` of one to three sentences: what shipped, where it lives, and anything left open.
5. **Report.** Reply with the task id and its new status.

## Rules

- Report facts: what ran, what passed, what failed. Include the command or check that proves each claim.
- Never paste secrets, tokens, or credentials into comments or outcomes.
- Open follow-up work with `celune-task`; do not widen the current task.
