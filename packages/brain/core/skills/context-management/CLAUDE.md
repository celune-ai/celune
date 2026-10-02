---
name: context-management
description: "Protocol for managing context window efficiently during long sessions.\n  TRIGGER when: context utilization exceeds 50%, sessions involve many files, or the agent notices degraded recall.\n  This is a protocol skill — it guides HOW to manage context, not WHEN to start."
user_invocable: false
---

# Context Management Protocol

Strategies for managing the context window efficiently during long sessions. Context is finite — use it wisely.

## When to Use

- Context utilization exceeds 50%
- Working on a large project with many files
- Session has been running for a long time
- Agent notices it's losing track of earlier decisions
- Between sprints in a multi-sprint build

## Principles

1. **Read only what you need.** Don't read entire files when you need one function.
2. **Summarize before compacting.** Write down key decisions and state before losing context.
3. **Use external memory.** Write important context to files, not just conversation.
4. **Batch related reads.** Read all files for a task at once, not one at a time across the session.

## Strategies

### Strategy 1: Context Handoff Summary

Before compacting or between sprints, write a handoff summary:

```markdown
## Context Handoff — {timestamp}

### Current State

- What we're building: {brief description}
- Current task: {task ID and title}
- Branch: {git branch}

### Key Decisions Made

1. {decision and rationale}
2. {decision and rationale}

### Files Modified This Session

- {file}: {what changed and why}

### Open Threads

- {unfinished work or pending decisions}

### Next Steps

1. {what to do next}
2. {what to do after that}
```

Write this to `memory/sessions/YYYY-MM-DD.md` or a task comment.

### Strategy 2: Selective File Reading

Instead of reading entire files:

- Use `Read` with `offset` and `limit` for specific sections
- Use `Grep` to find the specific code you need
- Read only the files relevant to the current task

### Strategy 3: External State Tracking

For multi-sprint builds, track state in files:

- Sprint progress in project metadata
- Task completion status in Supabase (not just in memory)
- Key decisions in task comments

### Strategy 4: Proactive Compaction

When context is getting heavy:

1. Run the pre-compaction hook to capture state automatically:
   ```bash
   bash packages/brain/core/hooks/pre-compact.sh
   ```
   This saves git state, active tasks, and working context to `~/.claude/state/pre-compact-recovery.json`
   and persists a handoff entry to `agent_memory` (category=handoff).
2. Use `/compact` to reduce context
3. Run the post-compaction hook to restore context:
   ```bash
   bash packages/brain/core/hooks/post-compact.sh
   ```
   This reads the recovery file and outputs a structured summary of what you were working on.
4. Re-read the current task description and continue

## Signs of Context Exhaustion

- Repeating questions that were already answered
- Forgetting file locations or conventions
- Making changes that contradict earlier decisions
- Reading the same file multiple times
- Responses getting slower or less focused

## Recovery

If context is exhausted mid-task:

1. Run `bash packages/brain/core/hooks/pre-compact.sh` to save state
2. Compact the context with `/compact`
3. Run `bash packages/brain/core/hooks/post-compact.sh` to restore context
4. Re-read only the essential context:
   - CLAUDE.md for conventions
   - Current task description (from the recovery summary)
   - Files being modified
5. Continue from where the recovery summary indicates

### Cross-Agent Handoff Recovery

When delegating work to another agent, the handoff is persisted to `agent_memory` (category=handoff).
If the receiving agent compacts, it can recover the delegation context:

```bash
# Query recent handoff memories
curl -s "$SUPABASE_URL/rest/v1/agent_memory?category=eq.handoff&order=created_at.desc&limit=1" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
