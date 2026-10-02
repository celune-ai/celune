# Session Hygiene Guidelines

Best practices for managing context window and session health.

## When to /compact

- **Between sprints** during `/build` execution
- **After closing gate tasks** (CR, DF) before Retro
- **Before overnight skill chaining** (`/closing-time` → `/afk-*`)
- **When context exceeds ~70%** capacity (quality degrades at ~75%)
- Include a handoff summary: completed tasks, remaining tasks, branch, blockers

## When to Start a New Session

- Switching to a completely different project/domain
- After a session reaches 80%+ context and `/compact` isn't enough
- When the conversation feels sluggish or responses lose quality

## Targeted Reading

- Use `offset` and `limit` with the Read tool for large files (don't read 500+ line files in full)
- Use Grep to find relevant sections before reading entire files
- Use sub-agents (Agent tool) for heavy exploration — keeps main context clean
- Skill refs are read on-demand, not loaded upfront — this is by design

## Output Discipline

- Don't paste long logs into conversation — redirect to files
- Don't repeat back large code blocks — reference file paths and line numbers
- Don't load skill reference docs unless you're about to execute that phase
- Summarize sub-agent results concisely (they return full context, you compress it)

## Context Budget Awareness

- 1M context is enabled (Claude Max 20x, $200/mo flat rate — no per-token cost)
- But quality still degrades at ~75% capacity regardless of window size
- Auto-compact fires at 95% — by then quality is already compromised
- Proactive compaction at 70% is the recommended threshold
- Skills are the biggest context consumer — layered architecture keeps cores lean
