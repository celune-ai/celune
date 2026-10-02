---
name: quick-flush
description: 'Mid-session memory save — session log + key decisions + CLAUDE.md update. Fast, no cleanup.'
user_invocable: true
---

# quick-flush

Lightweight mid-session save. Fast — no cleanup, no sync, no re-index.

Do all three steps, then surface a one-line confirmation.

---

## 1. Write session log entry

Append to `$VAULT_ROOT/memory/sessions/YYYY-MM-DD.md`

Use today's actual date. If the file doesn't exist yet, create it. If it exists, append:

```markdown
## Flush — HH:MM

### Decisions / context

- [key decisions, architecture choices, or preferences stated so far this session]

### Open threads

- [unfinished work or things to pick up if context compacts]
```

Keep it tight — bullet points only, no prose. The goal is recoverability, not a narrative.

---

## 2. Store key decisions in agent memory

For each decision or preference worth persisting across sessions:

```bash
python3 $VAULT_ROOT/scripts/memory_client.py store "descriptive-key" "content" --category decision --source "claude-code"
```

**When to use each category:**

- `decision` — architecture choices, tool selections, approach decisions
- `preference` — how the user wants things done (style, workflow, communication)
- `fact` — stable truths about the project or system
- `context` — situational (add `--ttl-days 7` for things that expire)

Skip if nothing new since the last flush.

---

## 3. Update CLAUDE.md or context files

Only if something stable changed this session:

- **Workflow or how-we-work** → `$VAULT_ROOT/CLAUDE.md`
- **MCP tools** → `claude/context/mcp-tools.md`
- **Flush/memory protocol** → `claude/context/memory-protocol.md`

Keep CLAUDE.md under ~250 lines. Push detail into context files.

---

## Done

One-line confirmation:

> **Flushed.** Session log updated, [N] decisions stored, CLAUDE.md [updated / unchanged]. Context preserved — keep going.
