---
name: project
description: 'Create a Supabase project with PRD, grouped sequenced tasks, and closing gates. Auto-detects type (feature/research/plan).'
user_invocable: true
requires:
  bins: [node]
---

# /project — Build a Full Project with Tasks

Deep-research a topic, create a Supabase project, populate it with detailed sequenced tasks.

## Arguments

`/project <topic, URL, or initiative name>`

---

### Step 0: Type Detection

Detect project type from user's language:

- "research", "investigate", "study", "analyze" → redirect to `/project-research`
- "plan for", "roadmap for", "initiative planning" → redirect to `/project-plan`
- "feature", "build", "implement", "add" → continue as feature (default)

### Step 1: Research & Discovery

**Read `~/.claude/skills/_shared/supabase-connect.md` for connection boilerplate.**

Determine input type and gather content:

- **YouTube URL**: Fetch transcript via TranscriptAPI
- **Web URL**: Use WebFetch
- **Broad topic**: Launch parallel Explore agents for code/arch, UI, research, and product perspectives
- **Direct initiative**: Research requirements, existing state, gaps

Scale agent count to scope (narrow = 1-2, broad = 3-4).

### Step 2: Draft PRD

Two parallel agents synthesize research into structured PRD:

- **Strategy agent**: Problem Statement, Goals, Non-Goals, Edge Cases, Requirements, User Stories, Success Metrics
- **Research agent**: Research & Discovery (User Insights, Competitive Landscape, Technical Landscape)

Merge into single PRD. Save reference content to vault if noteworthy.

### Step 2b: R&D Review

Scale to project size: small (1-3 tasks) = review directly. Medium (4-8) = UX review only. Large (9+) = UX + engineering review.

- **UX review**: Fill Design Direction section
- **Engineering review**: Fill Technical Approach section

### Step 2c: Project Consolidation Check

**Read `refs/consolidation.md` for full procedure.**

Before creating: query ALL non-completed projects (active, paused, AND archived) for overlap. Present options: Reactivate + absorb, Sequence after, or Create independent.

### Step 3: Create Project

**Read `refs/project-creation.md` for Supabase insert code and workspace resolution.**

Key fields: `name`, `description`, `status: "active"`, `project_type: "feature"`, `category`, `workspace_id`, `user_id`, `prd_content`, `prd_metadata`.

**Description format** — always include a structured brief in the project description (not just a vague sentence):

```markdown
**Goal:** <1 sentence — what this project delivers>
**Scope:** <bullet list of key deliverables/changes>
**Why:** <business justification — who benefits and how>
**Type:** <feature|system|plan> | **Sprints:** <N> | **Tasks:** <N>
```

This brief is what users see in the project list. `prd_content` holds the full PRD separately.

### Step 3b: Create PRD Task (Sprint 0 — always first)

Always create "Create a PRD" task at **sprint 0** as the FIRST task. If PRD already exists (from Steps 2/2b), create as `done` with outcome noting it was completed during project setup. This gives kanban a complete record and ensures the task list always starts with the PRD.

### Step 4: Create Tasks

**Read `refs/task-templates.md` for description format, closing task templates, and dependency wiring.**

Task description format (minimum `## What` + `## Approach`):

```markdown
## What

Concrete scope — name files, APIs, components.

## Value

Why it matters.

## Approach

Numbered implementation steps.

## Sequence

Dependencies and ordering.

## Blockers

"None" or specific decision needed.
```

**IMPORTANT:** Every task MUST include `workspace_id` and `user_id`.

### Step 4b: Create Closing Tasks

Always create 3 closing tasks at `sprint = max_impl_sprint + 1`:

1. **Code Review** — depends on ALL impl tasks
2. **Design Feedback** — depends on CR. Auto-skip (`done`) if no UI changes detected.
3. **Retro** — depends on DF

Wire dependencies: impl → CR → DF → Retro.

### Step 5: Summary Report

Present a structured summary with tasks in **correct execution order** (top-to-bottom = first-to-last):

1. **Project created** — name, ID, type, category
2. **Description brief** — the structured brief from Step 3
3. **PRD status** — always show prominently:
   > PRD status starts as `review`. AFK skills skip until approved. Use `/build <id>` to auto-approve.
4. **Tasks table** — ordered by sprint, with closing tasks ALWAYS at bottom:

```
| # | Sprint | Task | Assignee | Priority | Status | Depends On |
|---|--------|------|----------|----------|--------|------------|
| 0 | S0     | Create a PRD | strategy | high | ✅ Done | — |
| 1 | S1     | Impl task 1 | lead | high | inbox | PRD |
| 2 | S1     | Impl task 2 | design | normal | inbox | PRD |
| 3 | S2     | Impl task 3 | lead | high | inbox | Task 1 |
| — | ——     | —— CLOSING GATES —— | —— | —— | —— | —— |
| 4 | S3     | Code review and QA | qa | high | inbox | All impl tasks |
| 5 | S3     | Design feedback | design | high | inbox/skip | CR |
| 6 | S3     | Project retrospective | strategy | normal | inbox | DF |
```

The last 3 rows MUST always be CR → DF → Retro, in that order, with correct sequential dependencies.

5. **Dependency chain** — visualize: `PRD → Impl tasks → CR → DF → Retro`
6. **Blockers requiring input** — numbered list of specific decisions needed
7. **Scope estimate** — small/medium/large per task

## Error Handling & Edge Cases

- If Supabase API fails (auth error, timeout), validate credentials from `.env.local` before retrying
- If workspace resolution fails, fall back to querying `workspaces?limit=1` — never create without `workspace_id`
- If consolidation check finds overlapping archived projects, present reactivation option before creating duplicates
- If task creation fails mid-batch, report which tasks were created vs failed — don't leave orphan projects
- **Edge case:** If the user provides both a topic AND a UUID, resolve the UUID first — it may be an existing project to update
- **Edge case:** 15+ tasks? Consider splitting into multiple projects or using project groups
- **Validation:** Every task must have `workspace_id`, `user_id`, and `project_id` — missing fields cause invisible tasks
- **Security:** Never include API keys, secrets, or internal credentials in PRD content or task descriptions

## Conventions

- All tasks start as `inbox` (exceptions: PRD task if done, DF if auto-skipped)
- Priority: urgent (security/prod issue), high (significant gap), normal (good improvement), low (nice-to-have)
- Aim for 5-15 tasks per project
- Use parallel agents for multi-domain research
- Always verify task creation succeeded before wiring dependencies

## Project Types

- **feature** (default): Full lifecycle — PRD, impl, CR → DF → Retro
- **system**: Platform health/brain/agents/infra. Same closing gates.
- **research**: Q&A → research tasks → Retro → Deliverable. No PRD/CR/DF. Use `/project-research`.
- **plan**: Same as feature lifecycle. Use `/project-plan`.
