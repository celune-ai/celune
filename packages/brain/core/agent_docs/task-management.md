# Task Management Protocol

When assigned a Supabase task UUID by the team lead, use these commands:

```bash
# Claim the task (kanban card moves to In Progress, you show "Active" on Team page)
node packages/db/scripts/task-cli.mjs claim <task-id> --agent <your-agent-id>

# If blocked
node packages/db/scripts/task-cli.mjs block <task-id> --reason "..." --agent <your-agent-id>

# On completion — ALWAYS include --outcome with a summary of what was done
node packages/db/scripts/task-cli.mjs complete <task-id> --agent <your-agent-id> --outcome "Summary of what was built/delivered..."

# Add context comments
node packages/db/scripts/task-cli.mjs comment <task-id> --author <your-agent-id> --content "..."
```

**IMPORTANT:** Never overwrite a task's `description` with results. The description contains the original instructions/scope. All findings, results, and deliverables go in `--outcome`.

**MANDATORY:** Every `complete` call MUST include `--outcome`. The outcome is a concise, plain-text summary (no raw markdown) of what was delivered — files created/modified, key decisions, and verification results. Tasks completed without an outcome are incomplete. The outcome appears in the task drawer's Outcome section, which auto-expands for completed tasks.

## Agent IDs

Use the agent ID that matches your role. Agent IDs are configured per workspace. The lead agent and any sub-agents each have a unique lowercase identifier (e.g., `lead`, `reviewer`, `writer`, `designer`).

## Context Management

For long sessions or AFK work, follow the context window management protocol in `.claude/skills/context-management/CLAUDE.md`. Key rules: compact between tasks, save state before compacting, one task type per session.
