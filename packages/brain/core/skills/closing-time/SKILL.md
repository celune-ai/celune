---
name: closing-time
description: 'End-of-session ritual — audit, sync tasks, session log, memory store, backup, optional overnight handoff.'
user_invocable: true
---

# closing-time

End-of-session ritual for your vault. Do all steps in order.

---

## 0. Parse arguments (overnight skill chaining)

Check if the user passed instructions after `/closing-time` (e.g., `/closing-time run /afk-planning tonight`).

Parse for: **target skill** (`/afk-*` or `/deep-build`) and **custom instructions** (everything after skill name). Save for Step 12.

| Skill               | Best for                                                       |
| ------------------- | -------------------------------------------------------------- |
| `/afk-planning`     | Finding opportunities, creating projects, priority calibration |
| `/afk-nightwatch`   | Working through planned tasks, then research when done         |
| `/afk-housekeeping` | Chewing through low-hanging-fruit tasks                        |
| `/afk-building`     | Building product features (web, API, UI, DB)                   |
| `/afk-learning`     | Upgrading scripts, skills, memory, agent configs               |
| `/afk-designing`    | PRDs, user stories, prototypes, design review                  |

## 1. Assess the session type

Determine: **Coding** (celune-platform changes), **Vault/infra** (vault changes), or **Mixed**. This determines which steps to run.

## 2. Code audit (coding sessions only)

Scan files touched this session for: dead code, duplicate logic, inline helpers, oversized files (300+), stale TODOs, naming inconsistencies. Execute safe fixes, run `tsc --noEmit` after. Note risky changes as open threads.

## 3. Missed task audit

Spawn a sub-agent to read the session transcript and cross-reference against Supabase task board. Look for: mentioned-but-not-created items, TODOs, deferred work, partially-discussed features, discovered bugs. Create inbox tasks for genuinely missed items.

## 4. Sync inbox to task board

```bash
cd $VAULT_ROOT/scripts && python3 sync-tasks.py
```

## 5. Write session log

Append to `$VAULT_ROOT/memory/sessions/YYYY-MM-DD.md`:

```markdown
## Session — HH:MM

### What we built / changed

- [bullet list with file paths]

### Key decisions

- [architecture choices, preferences]

### Open threads

- [unfinished work, deferred items]

### Related

- [[knowledge-file-touched-this-session]]
- [[project-file-relevant]]
```

**Important:** Always include a `### Related` section with `[[wiki links]]` to knowledge files, project docs, or other vault files touched or referenced during the session. This keeps the Obsidian graph connected.

## 6. Store key decisions in agent memory

```bash
python3 $VAULT_ROOT/scripts/memory_client.py store "descriptive-key" "content" --category decision --source "claude-code"
```

Categories: `preference`, `decision`, `context`, `fact`, `general`. Skip if nothing genuinely new.

## 6b. Brain self-evolution (COG pattern)

**Read `refs/full-reference.md` for Supabase brain_manifest write code and rules.**

Write session learnings to brain manifest if: new architecture decisions, new patterns, security findings, or process improvements discovered. Use category `session-learning`, `is_core: false`.

## 6c. Memory sync (reverse Celune-to-local)

Run `/memory-sync --since <session_start_date>` to pull any Celune remote memories created this session back into your local vault. Auto-approve (no interactive confirmation) when invoked from closing-time. Include the sync report in the session log.

Skip if: session was vault-only (no Celune task work), or /memory-sync skill is not available.

## 7. Update CLAUDE.md or context files

- Identity/workflow changes → `$VAULT_ROOT/CLAUDE.md` (keep under ~250 lines)
- MCP tool changes → `claude/context/mcp-tools.md`
- Memory protocol changes → `claude/context/memory-protocol.md`

## 8. Redact secrets from history

```bash
$VAULT_ROOT/scripts/redact-history.sh
```

## 9. Re-index brain.sqlite

Run if 3+ vault `.md` files were created/modified: `python3 $VAULT_ROOT/scripts/init-memory-db.py --quiet`

## 9b. Auto-backup repos

**Read `refs/full-reference.md` for backup commands.** Back up the vault (commit + push main) and celune-platform (commit + push feature branch only, never main).

## 9c. Email session summary (opt-in)

**Read `refs/full-reference.md` for AgentMail script.** Skip if API key not set or session was short.

## 10. Session cost summary

```bash
npx ccusage@latest
```

Note today's cost in session log and closing summary.

## 11. Closing summary

Report: session log path, key decisions, task sync results, CLAUDE.md updates, open threads, today's cost. Ask: **Want me to post a Slack summary?** If yes, post to #daily-brief or DM the user.

## 11b. Pre-handoff compaction (if chaining to overnight skill)

Run `/compact` with handoff summary (what was accomplished, open threads, target skill/mission, active branch/project IDs).

## 12. Chain overnight skill (if requested)

Confirm before launching. Invoke via Skill tool. The AFK skill takes over from here.

---

## Error Handling & Edge Cases

- If `sync-tasks.py` fails (missing repo, auth error), log the error and continue — don't block the ritual
- If `redact-history.sh` finds secrets, note the count in the session log and verify they were scrubbed
- If `ccusage` fails or times out, skip cost summary — it's informational only
- If the session transcript is too large for the missed-task sub-agent, use targeted Grep instead of full read
- If git push fails on backup (network error, auth), warn the user but don't retry — manual fix required
- If no session changes were made (pure Q&A session), skip steps 2, 4, 7, 9 — only write the session log
- **Security:** Always run secret redaction (step 8) before any backup push. Never skip this step.
- **Validation:** Verify session log path exists before writing. Create date directory if missing.
- Sequence: Steps must run in order (1→12). Steps 6b and 9b depend on earlier steps completing successfully.
