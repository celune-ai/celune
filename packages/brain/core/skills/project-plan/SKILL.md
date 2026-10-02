---
name: project-plan
description: 'Create a Supabase project with PRD, grouped sequenced tasks, and closing gates. Handles feature, system, and plan types. Redirects research to /project-research.'
user_invocable: true
requires:
  bins: [node]
---

# /project-plan — Create a Project with Tasks

Deep-research a topic, create a Supabase project, populate it with detailed sequenced tasks.

## Arguments

`/project-plan <topic, URL, or initiative name>`

---

### Step 0: Type Detection

Detect project type from user's language:

- "research", "investigate", "study", "analyze" → redirect to `/project-research`
- "plan for", "roadmap for", "initiative planning" → `project_type: "plan"`
- "feature", "build", "implement", "add" → `project_type: "feature"` (default)
- Infrastructure, platform health, agents → `project_type: "system"`

### Step 1: Research & Discovery

**Read `~/.claude/skills/_shared/supabase-connect.md` for connection boilerplate.**

Determine input type and gather content:

- **YouTube URL**: Fetch transcript via TranscriptAPI
- **Web URL**: Use WebFetch
- **Broad topic**: Launch parallel Explore agents (RICK for code/arch, NOIR for UI, DELV for research, SAGE for product)
- **Direct initiative**: Research requirements, existing state, gaps

Scale agent count to scope (narrow = 1-2, broad = 3-4).

### Step 2: Draft PRD (SAGE + DELV)

Two parallel agents synthesize research into structured PRD:

- **SAGE**: Problem Statement, Goals, Non-Goals, Edge Cases, Requirements, User Stories, Success Metrics
- **DELV**: Research & Discovery (User Insights, Competitive Landscape, Technical Landscape)

Merge into single PRD. Save reference content to vault if noteworthy.

### Step 2b: R&D Review (NOIR + SCAN)

Scale to project size: small (1-3 tasks) = RICK reviews directly. Medium (4-8) = NOIR only. Large (9+) = NOIR + SCAN.

- **NOIR**: UX review, fill Design Direction section
- **SCAN**: Engineering review, fill Technical Approach section

### Step 2c: Project Consolidation Check

**Read `refs/consolidation.md` for full procedure.**

Before creating: query ALL non-completed projects (active, paused, AND archived) for overlap. Present options: Reactivate + absorb, Sequence after, or Create independent.

### Step 3: Create Project

**Read `refs/project-creation.md` for Supabase insert code and workspace resolution.**

Key fields: `name`, `description`, `status: "active"`, `project_type` (from Step 0), `category`, `workspace_id`, `user_id`, `prd_content`, `prd_metadata`.

**Description format** — always include a structured brief in the project description (not just a vague sentence):

```markdown
**Goal:** <1 sentence — what this project delivers>
**Scope:** <bullet list of key deliverables/changes>
**Why:** <business justification — who benefits and how>
**Type:** <feature|system|plan> | **Sprints:** <N> | **Tasks:** <N>
```

This brief is what users see in the project list. `prd_content` holds the full PRD separately.

### Step 3b: Create PRD Task (Sprint 0 — always first)

Always create "Create a PRD" task at **sprint 0** as the FIRST task.

**CRITICAL — PRD content gate:** The PRD task may ONLY be marked `done` if ALL of the following are true:

1. `prd_content` has been written to the project record in Supabase (not just `description`)
2. The PRD contains at minimum: Problem Statement, Goals, Requirements, and Technical Approach sections
3. The task `outcome` summarizes what the PRD covers

If Steps 2/2b produced a PRD, **verify `prd_content` is set on the project record** before marking this task done. If `prd_content` is null/empty, write the PRD content first, then mark done.

If no PRD was produced (e.g. fast project creation), create the task as `inbox` — never mark it done without the artifact.

### Step 4: Create Tasks

**Read `refs/task-templates.md` for description format, closing task templates, and dependency wiring.**

Task description format (minimum `## What` + `## Value`):

```markdown
## What

Concrete scope — what needs to be built or changed.

## Value

Why it matters — who benefits and what risk does it address.
```

Keep descriptions focused on the **what** and **why**. Do NOT prescribe implementation steps (## Approach), sequencing, or blockers — the executing agent figures out the how. Over-specifying technical details upfront cascades errors downstream.

**Pod-Aware Assignee Selection:**

| Domain                                    | Assignee |
| ----------------------------------------- | -------- |
| Product strategy, PRDs, content           | sage     |
| Architecture, code, engineering, security | rick     |
| UX/UI, design system                      | noir     |
| Code review, QA, testing                  | scan     |
| Web research, competitive analysis        | delv     |
| Career strategy                           | trek     |
| Personal brand                            | echo     |
| CRM, follow-ups                           | bond     |
| Goals, habits, wellness                   | vita     |
| Cross-domain, ambiguous                   | rick     |

**IMPORTANT:** Every task MUST include `workspace_id` and `user_id`.

### Step 4b: Create Closing Tasks

Always create 3 closing tasks at `sprint = max_impl_sprint + 1`:

1. **Code Review** (scan) — depends on ALL impl tasks
2. **Design Feedback** (noir) — depends on CR. Auto-skip (`done`) if no UI changes detected.
3. **Retro** (sage) — depends on DF

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
| 0 | S0     | Create a PRD | sage | high | ✅ Done | — |
| 1 | S1     | Impl task 1 | rick | high | inbox | PRD |
| 2 | S1     | Impl task 2 | noir | normal | inbox | PRD |
| 3 | S2     | Impl task 3 | rick | high | inbox | Task 1 |
| — | ——     | —— CLOSING GATES —— | —— | —— | —— | —— |
| 4 | S3     | Code review and QA | scan | high | inbox | All impl tasks |
| 5 | S3     | Design feedback | noir | high | inbox/skip | CR |
| 6 | S3     | Project retrospective | sage | normal | inbox | DF |
```

The last 3 rows MUST always be CR → DF → Retro, in that order, with correct sequential dependencies.

5. **Dependency chain** — visualize: `PRD → Impl tasks → CR → DF → Retro`
6. **Blockers requiring input** — numbered list of specific decisions needed
7. **Scope estimate** — small/medium/large per task

## Error Handling & Edge Cases

- If Supabase API fails (auth error, timeout), validate credentials from `.env.local` before retrying
- If workspace resolution fails, fall back to querying `workspaces?slug=eq.celune-app` — never create without `workspace_id`
- If consolidation check finds overlapping archived projects, present reactivation option before creating duplicates
- If task creation fails mid-batch, report which tasks were created vs failed — don't leave orphan projects
- **Edge case:** If the user provides both a topic AND a UUID, resolve the UUID first — it may be an existing project to update
- **Edge case:** 15+ tasks? Consider splitting into multiple projects or using project groups
- **Validation:** Every task must have `workspace_id`, `user_id`, and `project_id` — missing fields cause invisible tasks
- **Security:** Never include API keys, secrets, or internal credentials in PRD content or task descriptions

## Conventions

- All tasks start as `inbox` (exceptions: PRD task if done with verified prd_content, DF if auto-skipped)
- Priority: urgent (security/prod issue), high (significant gap), normal (good improvement), low (nice-to-have)
- Aim for 5-15 tasks per project
- Use parallel agents for multi-domain research
- Always verify task creation succeeded before wiring dependencies

## Project Types

- **feature** (default): Full lifecycle — PRD, impl, CR → DF → Retro
- **system**: Platform health/brain/agents/infra. Same closing gates.
- **plan**: Roadmaps, non-code initiatives. Same closing gates.
- **research**: Different workflow entirely. Redirect to `/project-research`.
