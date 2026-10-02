# Phase 4: Wrap-up — Templates & Procedures

## PR Review Comments (Agent Collaboration)

When GitHub PR review settings are enabled for the workspace, closing gate findings are posted as **PR review comments by celune[bot]** — not just in the PR body. The PR body retains the summary + test table, while detailed findings live in threaded review comments.

**Flow**: SCAN posts line-level review → NOIR replies → RICK replies with fix commits → SCAN approves → SAGE posts retro summary. All via `POST /api/github/pr-review`.

## PR Body Template

Use `gh pr edit <pr-number> --body "$(cat <<'EOF' ... EOF)"` to update the PR with this structure:

```markdown
## Summary

<1-3 sentences describing what this project/task delivers and why>

## Changes

- **Area 1**: description of changes
- **Area 2**: description of changes
- ...

## Tests

| Check | Status | Details |
|-------|--------|---------|
| Type Check | ✅ Pass / ❌ Fail | error count or "0 errors" |
| Build | ✅ Pass / ❌ Fail | compile time or error |
| Tests | ✅ Pass / ❌ Fail | N tests passed, M failed |
| Prettier | ✅ Pass / ❌ Fail | file count or issues |

## Code Review Findings

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | Critical | description | ✅ Fixed (commit) |
| 2 | High | description | ✅ Fixed |
| 3 | Medium | description | 📋 Follow-up |

**Summary**: X findings (Y critical, Z high). All critical/high fixed. M follow-up tasks created.

## Design Feedback

<DF summary or "No UI changes — design feedback auto-skipped">

- If UI changes: list findings, fixes applied, remaining items
- Include: dark mode, responsive, token compliance, a11y

## Retro Highlights

**Pros:**
- ...

**Cons:**
- ...

**Action Items:**
| # | Item | Status |
|---|------|--------|
| 1 | ... | ✅ Fixed |
| 2 | ... | 📋 Follow-up |

## Follow-up Tasks

| Task ID | Title | Priority | Assignee |
|---------|-------|----------|----------|
| abc123 | ... | high | rick |

## Manual Test Plan

Auto-generate based on what changed in the PR:

**UI Changes** (if component/page files modified):
- [ ] Renders correctly in dark mode
- [ ] Responsive at mobile (375px), tablet (768px), desktop (1440px)
- [ ] Loading states display properly
- [ ] Empty states display properly
- [ ] Error states handled gracefully
- [ ] Keyboard navigation works
- [ ] Screen reader announces correctly

**API Changes** (if route.ts files modified):
- [ ] Authentication required (401 without auth)
- [ ] Authorization checked (403 for wrong workspace)
- [ ] Input validation works (400 for bad input)
- [ ] Success response shape correct
- [ ] Error responses include useful messages

**Database Changes** (if migration files added):
- [ ] Migration applies cleanly
- [ ] Rollback works
- [ ] RLS policies verified
- [ ] Indexes appropriate for query patterns

🤖 Generated with [Celune](https://celune.ai)
```

## Tests Capture Script Pattern

Run each check individually to capture status:

```bash
# Type check
if pnpm type-check 2>&1; then
  TC_STATUS="✅ Pass"
  TC_DETAIL="0 errors"
else
  TC_STATUS="❌ Fail"
  TC_DETAIL="see output above"
fi

# Build
if pnpm build 2>&1; then
  BUILD_STATUS="✅ Pass"
else
  BUILD_STATUS="❌ Fail"
fi

# Tests
TEST_OUTPUT=$(pnpm test 2>&1)
if echo "$TEST_OUTPUT" | grep -q "Tests.*passed"; then
  TEST_STATUS="✅ Pass"
  TEST_DETAIL=$(echo "$TEST_OUTPUT" | grep -oP '\d+ tests? passed' | head -1)
else
  TEST_STATUS="❌ Fail"
fi

# Prettier
if npx prettier --check . 2>&1; then
  PRETTIER_STATUS="✅ Pass"
else
  PRETTIER_STATUS="❌ Fail"
  npx prettier --write .  # Auto-fix
fi
```

## Closing Gate Data Collection

Pull CR/DF/Retro data from Supabase task outcomes and comments:

```bash
# Get closing task outcomes for this project
node packages/db/scripts/task-cli.mjs list --project <project-id> --status done | grep -E "(Code Review|Design Feedback|retrospective)"
```

Or query directly:
```python
# Fetch CR task outcome
cr_task = supabase.from_('tasks').select('outcome,id').eq('project_id', PROJECT_ID).ilike('title', '%Code Review%').single()

# Fetch CR comments (findings detail)
cr_comments = supabase.from_('task_comments').select('content,author').eq('task_id', cr_task['id']).order('created_at')
```

## Follow-up Task Creation

For each unfixed finding from CR/DF/Retro:

```bash
node packages/db/scripts/task-cli.mjs create "Fix: <finding title>" \
  --priority high \
  --description "## What\n<finding description>\n\n## Value\n<risk if unaddressed>\n\n## Approach\n<fix steps>\n\n## Sequence\nNo dependencies.\n\n## Blockers\nNone"
```

Severity → Priority mapping:
- Critical → urgent
- High → high
- Medium → normal
- Low → low

## Self-Review Checklist (non-main PRs with auto-approve)

Before self-merging:

1. [ ] All QA checks pass (type-check, build, test, prettier)
2. [ ] No `console.log` or debug code left
3. [ ] No hardcoded secrets or API keys
4. [ ] No TODO comments without corresponding tasks
5. [ ] All modified files are intentional (no accidental includes)
6. [ ] PR description has QA table and findings summary
7. [ ] All critical/high CR findings are fixed
8. [ ] Task outcomes written to Supabase
9. [ ] Follow-up tasks created for deferred items

## Group PR Body Format

When all project PRs in a group are merged to the group branch:

```markdown
## Group: <Group Name>

### Projects Included
| # | Project | PR | Status |
|---|---------|-----|--------|
| 1 | Project A | #XX | ✅ Merged |
| 2 | Project B | #YY | ✅ Merged |

### Combined QA
| Check | Status |
|-------|--------|
| Type Check | ✅ Pass |
| Build | ✅ Pass |
| Tests | ✅ Pass |
| Prettier | ✅ Pass |

### Key Changes
- ...

### Requires Review
@<maintainer> — review required before merge to main.

🤖 Generated with [Celune](https://celune.ai)
```
