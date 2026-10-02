# Phase 3: Sprint 99 Closing Gates

See `refs/full-reference.md` lines 730-900 for complete closing gate procedures.

## Sequence

- **Feature/System/Plan**: Code Review (SCAN) → Design Feedback (NOIR) → Retro (SAGE)
- **Research**: Retro (SAGE) → Research Deliverable (SAGE)

## Agent PR Review Integration

When the workspace has GitHub connected and PR review settings enabled, closing gates post findings as **GitHub PR review comments via celune[bot]** instead of just task comments.

### Settings Check (before any PR comment)

```python
# Check workspace settings via API
GET /api/settings/github-review?workspace_id={wsId}
# Returns: { pr_summary_comments, agent_code_review, auto_complete_review_tasks }
```

- `pr_summary_comments = true` → agents post top-level summary comments
- `agent_code_review = true` → SCAN posts line-level review with REQUEST_CHANGES/APPROVE
- `auto_complete_review_tasks = true` → RICK fixes findings before SCAN approves; comments update live
- Any setting `false` → skip that feature, fall back to task comments only

### GitHub PR Review API

All agent comments go through: `POST /api/github/pr-review?workspace_id={wsId}`

```json
// Create line-level review (SCAN)
{ "action": "create_review", "owner": "...", "repo": "...", "pr_number": 123,
  "agent": "scan", "findings": [...], "summary": "...", "approve": false }

// Reply to a finding (NOIR, RICK)
{ "action": "reply", "comment_id": 456, "agent": "noir", "body": "..." }

// Post top-level comment (SAGE retro)
{ "action": "comment", "agent": "sage", "body": "..." }

// Edit existing comment (live status updates)
{ "action": "edit_comment", "comment_id": 789, "body": "updated markdown" }
```

## Code Review & QA (SCAN)

1. Claim task
2. Push branch, create PR:
   ```bash
   git push -u origin "$BRANCH"
   gh pr create --title "Feat: <Project Name>" --body "..."
   ```
3. Add reviewer: `<maintainer>` for PRs targeting main (always). `rickstrips` for non-main + auto-approve mode.
4. Run: `pnpm type-check && pnpm build && pnpm test && npx prettier --check .`
5. Fix prettier if needed: `npx prettier --write .`
6. Manual code review: security, quality, architecture, regression
7. **If `agent_code_review` enabled**: Post line-level review via `/api/github/pr-review` with `action: create_review`. Each finding gets a line-level comment with severity badge. Use `REQUEST_CHANGES` if critical/high findings exist.
8. **If disabled**: Post findings as task comment only (legacy behavior).
9. **Auto-create fix tasks** for every issue: `node packages/db/scripts/task-cli.mjs create --spawned-by <task-id>`
10. **If `auto_complete_review_tasks` enabled**: RICK implements fixes, replies to each comment with commit hash via `action: reply`. SCAN re-reviews and posts `APPROVE`.
11. **If disabled**: Fix tasks go to inbox as `📋 Deferred`. PR comment shows deferred status.
12. Log to `memory/code-review-log.md`
13. Write to task outcome (NOT description)
14. Post as task comment: `node packages/db/scripts/task-cli.mjs comment <task-id> --author scan --content "..."`

## Design Feedback (NOIR)

**Skip if already `done` (auto-skipped for no UI changes).**

1. Claim task
2. Review user-facing files: visual (tokens, spacing, dark mode, responsive), UX (flows, states, keyboard nav, ARIA), PRD compliance
3. Write structured document
4. **If `agent_code_review` enabled**: Read SCAN's review comments via `action: list_comments`. Reply to relevant findings with design perspective via `action: reply`.
5. **If `pr_summary_comments` enabled**: Post top-level DF summary via `action: comment`.
6. Post as task comment + write to outcome
7. Present suggestions via AskUserQuestion: "Auto-implement all" / "Let me review" / "Skip"
8. Create fix tasks with `--spawned-by` for approved items
9. **Design Approval Gate**: Check `~/.claude/state/auto_approve`. Auto-approve ON → proceed. OFF → ask the user.
10. Log to `memory/design-feedback-log.md`

## Retro (SAGE)

1. Claim task
2. Gather: PRD, CR findings, DF findings, all task outcomes
3. Write structured doc: **Pros → Cons → Action Items** (this exact order)
4. **Create Supabase task for EACH action item** with `--spawned-by <retro-task-id>`
5. **Append "Additional Steps" section** listing all created tasks (task ID, title, assignee)
6. **If `pr_summary_comments` enabled**: Post FULL retro document as top-level PR comment via `action: comment`.
7. Post as task comment + write to outcome
8. Log to `memory/retro-improvements.md`
9. **Auto-execute all improvement tasks**: 1-2 inline, 3+ spawn sub-agents

**CRITICAL: All closing task documents MUST be posted as comments.** Outcome field alone is insufficient — comments are the visible paper trail. When GitHub PR commenting is enabled, BOTH task comments AND PR comments are posted.
