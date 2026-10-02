---
name: build
description: "Execute a project or task end-to-end (validation, orchestration, sprints, closing gates). Takes UUID or natural language."
user_invocable: true
requires:
  bins: [node, pnpm]
---

# /build — Execute a Project or Task End-to-End

Unified execution engine. Validates, chooses orchestration mode, runs sprint-based lifecycle through delivery.

## Arguments

`/build <project URL | project UUID | task UUID | natural language with optional orchestration override>`

---

## Phase 0: Input Parsing & Mode Detection

**Read `~/.claude/skills/_shared/supabase-connect.md` for connection boilerplate.**

1. Parse argument: extract UUID or detect natural language
2. Query Supabase: try `projects` table first, then `tasks`
3. Resolve mode: `project` | `single-task` | `ask` (task with project_id → ask the user)
4. For project mode: fetch all tasks with `project_id=eq.{id}&order=created_at.asc`

**Read `refs/phase-0-checks.md` for consolidation check and PRD approval gate.**

---

## Phase 1: Validate & Standardize

Run 6 checks, auto-fix failures. Present Build Readiness Report.

**Read `refs/phase-1-validation.md` for detailed check procedures.**

| # | Check | What |
|---|-------|------|
| 1 | PRD | Has prd_content or PRD task (skip for research) |
| 2 | Quality Gate tasks | CR + DF + Retro exist (research: Retro + Deliverable only) |
| 3 | Descriptions | All tasks have `## What` + `## Value` |
| 4 | Assignees | No `unassigned` tasks (use pod delegation table) |
| 5 | Sprint metadata | All tasks have `metadata.sprint` set |
| 6 | Dependencies | Quality Gate tasks wired: impl → CR → DF → Retro |

---

## Phase 2: Orchestration Mode Selection

### Explicit Override

| User says | Mode |
|-----------|------|
| `team`, `agent team` | Agent Team |
| `yourself`, `solo` | Solo |
| `sub-agents`, `delegate` | Sub-agents |

### Auto-Select (no override)

| Mode | When |
|------|------|
| **Solo** | ≤5 impl tasks, all effort ≤ L |
| **Sub-agents** | 6-8 tasks OR XL tasks, ≤3 sprints |
| **Agent Team** | 9+ tasks OR 4+ sprints OR 4+ domains |

### Model Tiering

| Tier | Model | Agents |
|------|-------|--------|
| 1 | Opus | RICK |
| 2 | Sonnet | SAGE, NOIR, SCAN |
| 3 | Haiku | DELV, TREK, ECHO, BOND, VITA |

Present the Execution Plan table (sprint × task × assignee × model × effort) before proceeding.

**Read `refs/phase-2-orchestration.md` for scope signals, effort heuristics, and agent prompt templates.**

---

## Phase 2f: Git Branch Setup

**Read `refs/full-reference.md` Phase 2f for branch naming, merged-branch safety, group branch logic.**

Key rules:
- Resolve group branch FIRST (step 4) — determines BASE_REF for project branch
- If project has `group_id`: branch from group branch, PR targets group branch
- If no group: branch from `origin/main`, PR targets main
- Store branch + base_branch in project `metadata`
- Never branch from merged branches
- Never commit to `main`

---

## Phase 3: Execute

**CRITICAL — Task Status Lifecycle:**
Every task MUST transition through statuses in real-time as work happens:
1. **`in_progress`** — Set BEFORE starting any work on the task. The kanban board must reflect what's actively being worked on.
2. **`done`** — Set ONLY after the task's work is fully complete AND verified (API responded, follow-up tasks created, etc.)

Never skip `in_progress`. Never batch-complete tasks after the fact. The board should show live progress at all times.

For Quality Gate tasks (CR/DF/Retro): set to `in_progress` when starting the review, keep in `in_progress` while creating follow-up tasks, and only set to `done` after all sub-work (including follow-up task creation) is confirmed complete.

### Solo Mode

Per task: Set `in_progress` → RFC (L/XL only) → Implement → Verify → Set `done` with outcome.

### Sub-agent Mode

Per sprint: Spawn Agent tools with `run_in_background: true` → Wait → Merge worktrees → Clean up ALL worktrees (MANDATORY) → Inter-sprint gate (`pnpm type-check && pnpm build`) → Verify task completions → Next sprint.

### Agent Team Mode

TeamCreate → Per sprint: spawn named agents → Monitor via messages → Merge worktrees → Clean up → Gate → Next sprint → TeamDelete.

**Read `refs/phase-3-execution.md` for detailed agent prompts, worktree merge scripts, and task verification.**

### Pre-Sprint 99: Create Draft PR

**After all implementation sprints complete, push the branch and open a draft PR BEFORE starting Quality Gates.** This ensures SCAN, NOIR, and SAGE can post their findings as PR review comments — making the quality gate process visible and collaborative rather than silent.

```bash
git push -u origin "$BRANCH"
PR_BASE="${GROUP_BRANCH:-main}"
gh pr create --draft --base "$PR_BASE" --title "feat: <Project Name>" --body "<initial summary>"
```

Store the PR number in project metadata. Quality Gate agents will post comments on this draft PR during Sprint 99.

### Sprint 99: Quality Gates (CR → DF → Retro)

**MANDATORY. Sequential. Always last. Never skip. Never combine with CI checks.**

Quality Gates are review processes run by agents (SCAN, NOIR, SAGE). They are completely separate from CI checks (type-check, build, test, prettier). "Tests pass" does NOT mean Quality Gates are done.

Varies by project type:
- **Feature/System/Plan**: Code Review (SCAN) → Design Feedback (NOIR) → Retro (SAGE)
- **Research**: Retro (SAGE) → Research Deliverable (SAGE)

**Execution checklist — verify ALL boxes before moving to Phase 4:**
- [ ] CR task claimed and set to `in_progress` in Supabase
- [ ] SCAN agent spawned and code review findings collected
- [ ] Critical/High findings fixed, commits pushed
- [ ] CR task completed with outcome listing all findings
- [ ] DF task claimed (or auto-skipped if no UI changes)
- [ ] NOIR agent spawned and design feedback collected
- [ ] DF task completed with outcome
- [ ] Retro task claimed
- [ ] SAGE agent spawned (or self-run) with substantive retro
- [ ] Retro task completed with action items

**Read `refs/phase-3-closing-gates.md` for CR/DF/Retro procedures, PR creation, fix task auto-creation, and review protocols.**

---

## Phase 4: Wrap-up

### ⛔ PHASE 4 ENTRY GATE — DO NOT PROCEED WITHOUT THIS

Before running ANY Phase 4 step, answer these 3 questions:
1. **Did Sprint 99 (Quality Gates) run?** Check: are the CR, DF, and Retro tasks marked `done` in Supabase with outcomes? If NO → go back and run Sprint 99 first.
2. **Are there unfixed Critical/High findings?** If YES → fix them before proceeding.
3. **Were follow-up tasks created for Medium+ deferred findings?** If NO → create them now.

If you cannot answer YES/YES/YES, you are NOT ready for Phase 4. Go back to Sprint 99.

**COMMON FAILURE MODE: After the last implementation sprint, momentum bias pulls toward "ship it." The CI checks (Step 1 below) feel like "QA" but they are NOT — they are automated checks. Quality Gates (CR/DF/Retro) are the actual review process and must complete BEFORE the draft PR is marked ready.**

---

### Step 1: CI Checks (MANDATORY — all 4 checks required)

These are automated CI checks, NOT quality gates. Run them, but do NOT confuse them with the Quality Gates from Sprint 99.

**CRITICAL: You MUST run ALL 4 checks below. The PR body MUST contain exactly 4 rows in the CI Checks table. Do NOT skip `pnpm build`.**

Run each check individually and capture pass/fail:

```bash
pnpm type-check    # → pass/fail  (Row 1: Type Check)
pnpm build         # → pass/fail  (Row 2: Build) ← NEVER SKIP
pnpm test          # → pass/fail  (Row 3: Tests)
npx prettier --check .  # → pass/fail  (Row 4: Prettier)
```

Build the **CI Checks** table — **verify it has exactly 4 rows before proceeding**:

```markdown
## CI Checks

| Check | Status | Details |
|-------|--------|---------|
| Type Check | ✅ Pass | 0 errors |
| Build | ✅ Pass | platform compiled in Xs |
| Tests | ✅ Pass | N tests passed |
| Prettier | ✅ Pass | All files formatted |
```

If any check fails, fix it before proceeding. Re-run and update the table.
**Self-check: count the rows. If < 4, you missed a check. Go back and run it.**

### Step 2: Collect Quality Gate findings

Pull outcomes from Sprint 99 Quality Gate tasks (CR, DF, Retro) and format. **If this section is empty, you skipped Sprint 99 — go back.**

**Code Review Findings** (from SCAN's CR task outcome/comments):
```markdown
| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | Critical | ... | ✅ Fixed (commit abc123) |
| 2 | High | ... | ✅ Fixed |
| 3 | Medium | ... | 📋 Follow-up task created |
```

**Design Feedback** (from NOIR's DF task — skip if auto-skipped):
- Summary of UX findings and fixes applied

**Retro Action Items** (from SAGE's Retro task):
- List all action items with status (fixed / follow-up created)

### Step 3: Update draft PR with full documentation and mark ready

Push remaining commits, update the draft PR body using `gh pr edit`, then mark it ready with `gh pr ready`:


```markdown
## Summary
<1-3 sentences: what this project/task delivers>

## Changes
<bullet list of key changes by area>

## CI Checks
<CI Checks table from Step 1 — type-check, build, tests, prettier>

## Quality Gates

### Code Review (SCAN)
<Findings table from Sprint 99 CR — severity, finding, fix status>

### Design Feedback (NOIR)
<DF summary or "No UI changes — auto-skipped">

### Retrospective (SAGE)
<Key action items and their status>

## Follow-up Tasks
<List of inbox tasks created for unfixed findings>

## Manual Test Plan
<Auto-generated checklist based on what changed:>
- [ ] UI changes → visual QA items (dark mode, responsive, states)
- [ ] API changes → endpoint test items (auth, validation, error cases)
- [ ] DB changes → migration verification items
```

### Step 4: Create follow-up tasks

For every unfixed CR/DF/Retro finding:
```bash
node packages/db/scripts/task-cli.mjs create "<title>" \
  --priority <severity-mapped> \
  --description "## What\n<finding>\n\n## Value\n<risk if unaddressed>"
```

### Step 5: Write detailed task outcomes

Every completed task MUST have an outcome with minimum detail:
- What was built/changed (1-2 sentences)
- Key files modified
- Verification result (pass/fail)

Use: `node packages/db/scripts/task-cli.mjs complete <id> --agent <agent> --outcome "<detailed outcome>"`

### Step 6: PR merge rules

- PRs targeting `main` → always `<maintainer>` review, never auto-merge
- Non-main + auto-approve → self-review checklist then merge

### Step 7: Post-merge housekeeping

1. **Group PR check**: If all group projects merged, create group PR targeting main
2. **Verify all tasks done**: Query Supabase for non-done tasks in this project
3. **Copy SQL migrations**: `cp packages/db/schema/migrations/*.sql ~/Documents/sqleditor/`
4. **Clean up**: TeamDelete, worktrees, sentinel files
5. **Final Summary**: Sprint results table, CI check results, Quality Gate highlights (CR/DF/Retro), follow-up tasks created

**Read `refs/phase-4-wrapup.md` for PR body template, group PR format, and self-review checklist.**

---

## Context Hygiene

Trust auto-compaction — Opus 4.6 handles long context without "context anxiety." Manual compaction is rarely needed.

Only compact manually if:
- Context exceeds 80% and you notice quality degradation in your own output
- You're about to spawn sub-agents and need headroom for their results

Do NOT compact between sprints, after closing gates, or after Phase 1 by default. Let auto-compaction handle it.

## Edge Cases

| Case | Action |
|------|--------|
| No tasks yet | Error: use `/project-plan` first |
| All tasks done | Skip to Phase 4 verification |
| Blocked task | Skip task + all transitive dependents, warn |
| Agent failure | Mark blocked, continue independent tasks, report |
| Large project (10+ tasks) | Sub-agents as context firewalls, compact between sprints |
| Single-task mode | Skip Phase 1, auto-select Solo, run Phase 3-4 |

## Best Practices

- **Auth**: Never expose service keys client-side. Use `createServiceClient()` server-side only.
- **Validation**: Validate all inputs at API boundaries. Use Zod or manual type guards.
- **RLS**: Every new table needs Row Level Security policies.
- **Migrations**: Auto-copy SQL to `~/Documents/sqleditor/`. Include rollback.
- **Types**: `@repo/types` is single source of truth. No inline type definitions.
- **Design tokens**: Use theme.css tokens. No hardcoded colors.
- **Commits**: Clear messages, atomic changes, signed with Co-Authored-By.
- **Task hygiene**: Claim at start, complete on delivery. Kanban must reflect real-time state.

## Relationship to Other Skills

| Skill | Relationship |
|-------|-------------|
| `/project-plan` | Creates projects + tasks. `/build` executes them. |
| `/afk-building` | Single-task execution loop. `/build` subsumes this. |
| `/task` | Creates individual tasks. `/build` can execute them. |
