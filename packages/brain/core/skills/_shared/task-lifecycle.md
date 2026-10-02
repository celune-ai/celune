# Task Lifecycle Reference

## Task CLI Commands

```bash
# Create task
node packages/db/scripts/task-cli.mjs create --title "..." --description "..." --project PROJECT_ID --priority high --assignee rick --status inbox

# Claim task (always before starting work)
node packages/db/scripts/task-cli.mjs claim <task-id> --agent rick

# Complete task (ALWAYS include --outcome)
node packages/db/scripts/task-cli.mjs complete <task-id> --agent rick --outcome "Summary of what was done."

# Update task
node packages/db/scripts/task-cli.mjs update <task-id> --depends-on "id1,id2" --metadata '{"sprint": 2}'

# Post comment
node packages/db/scripts/task-cli.mjs comment <task-id> --author rick --content "..."

# List tasks
node packages/db/scripts/task-cli.mjs list --project PROJECT_ID --sprint 1

# Create spawned task (linked to parent)
node packages/db/scripts/task-cli.mjs create --title "..." --spawned-by <parent-task-id>
```

## Task Description Format

Every task MUST have at minimum `## What` and `## Approach`:

```markdown
## What

Concrete scope — name files, APIs, components.

## Value

Why it matters.

## Approach

Numbered implementation steps.

## Sequence

Dependencies and ordering.

## Blockers

"None" or specific decision needed.
```

## Status Flow

`inbox` → `planning` → `in_progress` → `review` → `done`

Also: `blocked` (with reason), `archived`

## Rules

- Every piece of work gets a task — no undocumented changes
- Claim before writing code
- Complete with outcome when done (outcome = what was built, NOT instructions)
- Write findings to `outcome` field, NOT `description` (description has instructions)
- Post closing gate documents as comments (outcome alone is insufficient)
