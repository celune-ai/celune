---
name: project-research
description: 'Create a research project with Q&A intake, parallel research tasks, retro, and synthesized deliverable. No PRD/CR/DF.'
user_invocable: true
---

# /project-research — Research Project with Deliverable

Create a research project: Q&A intake, parallel research tasks, retro, and a synthesized deliverable.

## Arguments

`/project-research <topic or question>`

## Workflow

### Step 0: Q&A Intake

Use `AskUserQuestion` (up to 4 questions per call):

1. **Topic & Why** — What are we researching and what decision does it inform?
2. **Output type** — Suggest format (Business Plan, RFC, PRD, Competitive Analysis, Market Map, Technical Feasibility Study, Strategy Brief, Investment Memo)
3. **Depth** — Quick / Standard / Deep / Exhaustive
4. **Key questions** — Propose 3-5 specific questions the research must answer

### Step 1: Create Project

**Read refs/scripts.md for Supabase project creation code.** Read `~/.claude/skills/_shared/supabase-connect.md` for connection boilerplate. No `prd_content` — research projects skip PRDs.

**Description format** — always include a structured brief:

```markdown
**Goal:** <1 sentence — what this research answers>
**Output:** <deliverable type from Q&A>
**Depth:** <Quick/Standard/Deep/Exhaustive>
**Key Questions:** <3-5 bullet points>
```

### Step 2: Create Research Tasks

Topic-driven, no fixed template. Common agent assignments:

| Pattern               | Agent | When                     |
| --------------------- | ----- | ------------------------ |
| Competitive landscape | DELV  | Market/product research  |
| User pain points      | DELV  | User research            |
| Technical feasibility | RICK  | Engineering research     |
| UI/UX patterns        | NOIR  | Design research          |
| Content synthesis     | SAGE  | Writing/content research |
| Regulatory review     | SCAN  | Compliance research      |

Sprint 1 = parallel research. Sprint 2+ = synthesis/dependent. Use structured descriptions (What/Approach/Sequence/Blockers).

### Step 3: Create Closing Tasks (2 only)

**Read refs/scripts.md for retro and deliverable task creation code.**

- **Retro** (SAGE) — blocked by ALL research tasks
- **Research Deliverable** (SAGE) — blocked by retro, saves to vault

Dependency chain: All research tasks -> Retro -> Deliverable

### Step 4: Summary Report

Present with tasks in **correct execution order** (top-to-bottom = first-to-last):

```
| # | Sprint | Task | Assignee | Priority | Depends On |
|---|--------|------|----------|----------|------------|
| 1 | S1     | Research task 1 | delv | high | — |
| 2 | S1     | Research task 2 | rick | high | — |
| 3 | S2     | Synthesis task | sage | high | S1 tasks |
| — | ——     | —— CLOSING —— | —— | —— | —— |
| 4 | S3     | Retrospective | sage | normal | All research |
| 5 | S3     | Research deliverable | sage | high | Retro |
```

Last 2 rows MUST always be Retro → Deliverable in that order. Include dependency chain visualization.

## Error Handling

- No Q&A response: save partial context as draft project
- Supabase auth error: validate credentials before retry
- No clear agent match: default DELV (research) or RICK (technical)
- Existing UUID provided: update existing project, don't duplicate
- Every task must have `workspace_id` and `user_id`

## Conventions

- Research projects: NO PRD, NO Code Review, NO Design Feedback
- Closing: Retro -> Deliverable (2 tasks only)
- All tasks start as `inbox`
- Always run consolidation check to prevent duplicate research projects
