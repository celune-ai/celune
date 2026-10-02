# Phase 1: Build Readiness Validation

6 checks, auto-fix all failures. See `refs/full-reference.md` lines 194-324 for complete details.

## Per-Type Check Matrix

| Check | Feature | System | Plan | Research |
|-------|---------|--------|------|----------|
| PRD | Required | Optional | Required | Skip |
| CR | Required | Required | Required | Skip |
| DF | Required | Required | Required | Skip |
| Retro | Required | Required | Required | Required |
| Research Deliverable | Skip | Skip | Skip | Required |

## Check 1: PRD
Skip for research. Verify `prd_content` or PRD task exists. Auto-fix: create sprint 0 PRD task via `node packages/db/scripts/task-cli.mjs create --title "Create a PRD" --project PROJECT_ID --priority high --assignee sage --status inbox`, then set `metadata.sprint = 0`.

## Check 2: Closing Tasks
Feature/System/Plan need: "Code review and QA", "Design feedback", "Project retrospective".
Research needs: "Project retrospective", "Research deliverable: {output_type}".
Auto-fix: create missing tasks at `metadata.sprint = max_impl_sprint + 1`.

## Check 3: Task Descriptions
All tasks need `## What` + `## Approach`. Auto-fix: preserve original as HTML comment, rewrite into structured format.

## Check 4: Assignees
No `unassigned`. Auto-fix via pod delegation:

| Domain | Assignee |
|--------|----------|
| Product strategy, PRDs, content | sage |
| Architecture, code, engineering, security | rick |
| UX/UI, design system | noir |
| Code review, QA, testing | scan |
| Web research, competitive analysis | delv |
| Career strategy | trek |
| Personal brand | echo |
| CRM, follow-ups | bond |
| Goals, habits, wellness | vita |
| Cross-domain, ambiguous | rick |

## Check 5: Sprint Metadata
All tasks need `metadata.sprint`. Auto-fix: topological sort of `depends_on` graph. Sprint 0 = PRD, Sprint 1+ = impl, Closing sprint = max impl + 1.

## Check 6: Dependencies
Feature/System/Plan: impl → CR → DF → Retro.
Research: research → Retro → Deliverable.
Auto-fix via `node packages/db/scripts/task-cli.mjs update <id> --depends-on "id1,id2"`.

## Build Readiness Report

Present as table:
```
| # | Check | Status | Action Taken |
|---|-------|--------|-------------|
| 1 | PRD | PASS/FIXED | ... |
```
