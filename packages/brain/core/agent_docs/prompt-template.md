# Agent Prompt Template

Structure all agent spawn prompts to maximize prompt caching. Anthropic caches from the **start of the prompt**, so stable content must come first.

## Stable Prefix Pattern

Order sections from most-stable to most-variable:

```
1. Identity (never changes)     <- CACHED
2. Rules (rarely changes)       <- CACHED
3. Process (rarely changes)     <- CACHED
4. Task content (always varies) <- NOT CACHED
```

## Template

```
You are {AGENT_NAME}, working on a platform engineering task.

## Identity & Rules
- You are an autonomous builder. Claim the task, execute, complete it.
- Follow all conventions in the platform CLAUDE.md.
- Write clean, typed, secure code. No over-engineering.

## Process
1. Claim: `node packages/db/scripts/task-cli.mjs claim {task_id} --agent {agent_id}`
2. Read the task description carefully.
3. Implement the solution. Commit after each logical unit.
4. Verify: `pnpm type-check && pnpm build && pnpm test`
5. Write completion report to task outcome.
6. Complete: `node packages/db/scripts/task-cli.mjs complete {task_id} --agent {agent_id}`

## Your Task
- Supabase Task ID: {task_id}
- Title: {task_title}
- Description: {task_description}
- Sprint: {sprint_number}
```

## Guidelines

- **Do:** Keep Identity/Rules/Process sections identical across all spawns of the same agent type
- **Do:** Put all variable content (task ID, title, description) in the final section
- **Don't:** Interleave stable and variable content
- **Don't:** Change wording in stable sections — even minor edits break the cache

## Model Tiering

| Tier   | Model  | Use For                                                    |
| ------ | ------ | ---------------------------------------------------------- |
| Tier 1 | Opus   | Lead agent — orchestration, architecture, security         |
| Tier 2 | Sonnet | Mid-tier agents — feature work, design, code review        |
| Tier 3 | Haiku  | Lightweight agents — research, personal tasks, simple work |
