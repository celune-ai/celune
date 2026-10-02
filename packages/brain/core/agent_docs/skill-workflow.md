# Skill Chaining — End-to-End Agent Workflow

Map of how skills chain together during a task lifecycle. Each step references the skill that governs it.

## Task Lifecycle

```
Task Claim -> Context Load -> [Implementation | Bug Fix] -> Code Review -> Task Complete
```

---

## Implementation Path

1. **Claim task** — `node packages/db/scripts/task-cli.mjs claim <id> --agent <name>`
   See: `.claude/agent_docs/task-management.md`

2. **Load context** — Read task description first, then only the files you'll modify.
   See: `.claude/skills/context-management/CLAUDE.md` (progressive disclosure checklist)

3. **RED** — Write a failing test that describes expected behavior. Confirm it fails for the right reason.
   See: `.claude/skills/tdd/CLAUDE.md` Phase 1

4. **GREEN** — Write minimum code to pass the test. Run full suite.
   See: `.claude/skills/tdd/CLAUDE.md` Phase 2

5. **REFACTOR** — Clean up implementation. Tests must stay green after each change.
   See: `.claude/skills/tdd/CLAUDE.md` Phase 3

6. **Code Review gate** — Run Quick or Full review checklist. Fix all failures before closing.
   See: `.claude/skills/code-review/CLAUDE.md`

7. **Complete task** — `node packages/db/scripts/task-cli.mjs complete <id> --agent <name>`

---

## Bug Fix Path

1. **Claim task** — same as above.

2. **Load context** — same as above.

3. **REPRODUCE** — Confirm the bug exists. Get exact error, repro steps.
   See: `.claude/skills/debugging/CLAUDE.md` Phase 1

4. **ISOLATE** — Trace from symptom to specific file and function.
   See: `.claude/skills/debugging/CLAUDE.md` Phase 2

5. **NARROW** — Find root cause. Write one sentence explaining it.
   See: `.claude/skills/debugging/CLAUDE.md` Phase 3

6. **RED** — Write a regression test that fails without the fix.
   See: `.claude/skills/tdd/CLAUDE.md` Phase 1

7. **FIX + VERIFY** — Apply minimal fix, run full suite.
   See: `.claude/skills/debugging/CLAUDE.md` Phase 4

8. **Code Review gate** — same as implementation path.

9. **Complete task** — same as above.

---

## Decision Points

| Decision              | Rule                                                                                   | Reference                                     |
| --------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| Quick vs Full review  | Config/docs/style -> Quick. Everything else -> Full.                                   | `.claude/skills/code-review/CLAUDE.md`        |
| When to use worktrees | Parallel sub-agents modifying code, risky refactors, AFK multi-task                    | `.claude/skills/worktree-workflow/CLAUDE.md`  |
| When to compact       | Repeating yourself, forgetting decisions, phase transitions                            | `.claude/skills/context-management/CLAUDE.md` |
| TDD required?         | Bug fixes, new features, API/logic changes -> required. Config/docs/style -> optional. | `.claude/skills/tdd/CLAUDE.md`                |
