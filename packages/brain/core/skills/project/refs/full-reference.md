---
name: project
description: "Create a Supabase project with grouped, sequenced tasks.\n  TRIGGER when: the user says '/project', 'create a project', 'build a project for', 'plan out', or describes a multi-task initiative. Auto-detects type: feature (default), research (redirects to /project-research), plan (redirects to /project-plan).\n  DO NOT TRIGGER when: single task creation (/task), executing a project (/build), or daily planning (/todays-project)."
user_invocable: true
---

# /project — Build a Full Project with Tasks

Deep-research a topic or initiative, create a Supabase project, and populate it with detailed, sequenced tasks.

## Arguments

`/project <topic, URL, or initiative name>`

- A YouTube URL → fetch transcript, extract principles, build project + tasks from findings
- A topic (e.g., "platform security hardening") → research, gap analysis, project + tasks
- A codebase area (e.g., "admin app overhaul") → audit, plan, project + tasks
- A URL → fetch content, extract scope, project + tasks
- An initiative name (e.g., "launch marketing site v2") → scope out, project + tasks

## Workflow

### Step 0: Type Detection

Before starting research, determine the project type:

1. **Explicit type** — If the user specifies type ("research project", "plan for", "research into"), use it:
   - "research project", "investigate", "study", "analyze the market" → redirect to `/project-research`
   - "plan for", "roadmap for", "initiative planning", "plan out" (non-code) → redirect to `/project-plan`
   - "feature", "build", "implement", "add" → continue as feature (default)

2. **Infer from context** — If no explicit type:
   - Research question, market analysis, competitive study, feasibility assessment → redirect to `/project-research`
   - Planning exercise, roadmap, initiative scoping, strategy work → redirect to `/project-plan`
   - Product feature, code change, system improvement → continue as feature (default)

3. **When redirecting**: Use the Skill tool to invoke `/project-research` or `/project-plan` with the original topic.

### Step 1: Research & Discovery

Determine input type and gather raw content. Use multiple agents in parallel when the scope is broad.

**YouTube URL:**

```bash
KEY=$(grep TRANSCRIPT_API_KEY {VAULT_ROOT}/.env | cut -d"'" -f2)
curl -s -H "Authorization: Bearer $KEY" \
  "https://transcriptapi.com/api/v2/youtube/transcript?video_url=VIDEO_URL&format=text&send_metadata=true"
```

**Web URL:** Use WebFetch to extract content.

**Broad topic / codebase area:** Launch parallel Explore agents for different facets, using pod-aware delegation:

For **product/engineering** topics:

```
Agent 1 (RICK): Investigate code architecture, dependencies, security, infra
Agent 2 (NOIR / Design): Review UI components, accessibility, responsive design
Agent 3 (DELV / Research): Research competitive landscape, prior art, technical options
Agent 4 (SAGE / PM): Evaluate feature scope, prioritization, user impact
```

For **personal** topics:

```
Agent 1 (TREK / Career): Research industry trends, skill gaps, opportunities
Agent 2 (ECHO / Brand): Audit current online presence, content strategy
Agent 3 (BOND / Relationships): Map existing network, identify connection gaps
Agent 4 (VITA / Growth): Review current goals, habits, wellness routines
```

Scale agent count to the scope — a narrow topic may only need 1-2 agents.

**Direct initiative:** Research what the initiative requires, what exists, and what's needed.

### Step 2: Draft PRD (SAGE + DELV)

SAGE (PM) and DELV (Research) collaborate to produce the initial PRD draft. This is the synthesis step — raw research becomes structured requirements.

Launch two agents in parallel:

```
Agent 1 (SAGE / PM): Synthesize research into Problem Statement, Goals, Non-Goals,
  Edge Cases & Failure Modes, Requirements (functional + non-functional),
  User Stories, Success Metrics.
  Focus on: user value, scope boundaries, measurable outcomes, edge cases.

Agent 2 (DELV / Research): Synthesize research into Research & Discovery section —
  User Insights, Competitive Landscape, Technical Landscape.
  Focus on: evidence, prior art, constraints, opportunities.
```

Merge their outputs into a single PRD draft using this structure:

```markdown
## Problem Statement

## Research & Discovery (from DELV)

### User Insights

### Competitive Landscape

### Technical Landscape

## Goals

## Non-Goals

## Edge Cases & Failure Modes

## Requirements (from SAGE)

### Functional

### Non-Functional

### User Stories

## Design Direction (placeholder for NOIR)

## Technical Approach (placeholder for RICK)

## Open Questions & Decisions

## Success Metrics
```

If the source content is reference-worthy, save to vault:

```
{VAULT_ROOT}/05-knowledge/<topic-slug>.md
```

### Step 2b: R&D Review (NOIR + SCAN)

The draft PRD goes to Design and Code Review for feedback. Each reviewer contributes their section and challenges the requirements.

Launch reviewers in parallel:

```
Agent 1 (NOIR / Design): Review requirements from a UX perspective. Propose interaction
  patterns, flag accessibility concerns, identify missing user flows. Fill in the
  "Design Direction" section. Challenge any requirements that conflict with good UX.

Agent 2 (SCAN / Code Reviewer): Review requirements from an engineering perspective. Flag
  technical risks, complexity, security implications. Fill in the "Technical Approach"
  section. Challenge any requirements that are infeasible or under-specified.
```

**Merge feedback:**

1. Incorporate Design Direction and Technical Approach sections
2. Update Requirements based on reviewer feedback (add constraints, refine scope)
3. Log any unresolved disagreements in the "Open Questions & Decisions" table
4. Set PRD status to `review` if open questions remain, `draft` if still iterating

Scale the review to the project scope:

- **Small projects** (1-3 tasks): RICK reviews directly, skip NOIR/SCAN
- **Medium projects** (4-8 tasks): NOIR review
- **Large projects** (9+ tasks): Full review (NOIR + SCAN)

### Step 2c: Project Consolidation Check

Before creating a new project, check for **ALL** existing projects that overlap — including archived and paused ones. This prevents duplicate work, fragmented task boards, and wasted context. Archived projects are the most common source of duplicates: a project gets archived, then a new one is created for the same domain.

```python
import json, urllib.request, re

# Fetch ALL non-completed projects (active, paused, AND archived)
# Completed projects are done — they're not duplicates. But archived/paused ones
# may need to be reactivated instead of creating a new project.
req = urllib.request.Request(
    f"{SUPABASE_URL}/rest/v1/projects?status=neq.completed&select=id,name,description,status,project_type,category,prd_content",
    headers={**headers, "Prefer": ""},
)
resp = urllib.request.urlopen(req, timeout=10)
candidate_projects = json.loads(resp.read().decode())
```

**For each candidate project, check for overlap by:**

1. **Name/description similarity** — Does the existing project cover the same domain or feature area?
2. **Task overlap** — Fetch tasks for candidate projects. Do any tasks duplicate what the new project would create?
3. **PRD overlap** — If the existing project has a PRD, does it already address the same problem statement or requirements?

**When overlap is found, present options to the user via `AskUserQuestion`:**

Include the existing project's **current status** (active/paused/archived) in the prompt so the user knows the state:

```
Question: "Found {N} project(s) that overlap with this new project:
  - {project_name} (status: {status}, {task_count} tasks)
How should we proceed?"
Options:
  1. "Reactivate and absorb" — "Reactivate {existing_project_name} (if archived/paused), add new tasks as additional sprints"
  2. "Create separate, sequence after" — "Create new project but note dependency on {existing_project_name}"
  3. "Create separate, independent" — "No relationship — proceed as standalone project"
  4. (Free text) — "Other approach"
```

**If reactivating and absorbing into existing project:**

- Set existing project status to `active` (if archived/paused)
- Complete any stale tasks from the old scope that are no longer relevant
- Skip Step 3 (project creation) — use the existing project ID
- In Step 4, create tasks under the existing project with sprint numbers that follow the existing sprints
- Update the existing project's PRD with an addendum section covering the new scope
- Update the existing project's description to reflect expanded scope

**If sequencing after existing:**

- Create the new project normally but add a note in the PRD's Dependencies section
- Set the new project's first sprint tasks to depend on the existing project's closing tasks (if applicable)

**If no overlap found:** Proceed normally to Step 3.

This check is critical for large initiatives that may have been partially scoped in earlier projects (e.g., RBAC tasks living in one project while a broader "External User Readiness" project covers the same ground). **The most common failure mode is creating a new project for a domain that already has an archived project — always check archived projects.**

### Step 3: Create Project

Create the Supabase project to group all tasks:

```python
import json, urllib.request

import subprocess
_repo_root = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
env_file = os.path.join(_repo_root, "apps", "platform", ".env.local")
if not os.path.exists(env_file):
    env_file = os.path.join(_repo_root, "apps", "admin", ".env.local")
SUPABASE_URL = SUPABASE_KEY = ""
with open(env_file) as f:
    for line in f:
        if line.startswith("NEXT_PUBLIC_SUPABASE_URL="):
            SUPABASE_URL = line.split("=", 1)[1].strip()
        elif line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
            SUPABASE_KEY = line.split("=", 1)[1].strip()

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

# ── Resolve workspace_id (REQUIRED — projects.workspace_id is NOT NULL) ──
# 1. Read active workspace from state file
# 2. If the project CLEARLY belongs to a different workspace (e.g., marketing site
#    project when active workspace is "Celune Platform"), ask via AskUserQuestion:
#      "This project looks like it belongs in {other_workspace}. Are you sure it
#       goes in {active_workspace}?"
#      Options: "Yes, keep it in {active_workspace}" | "No, put it in {other_workspace}"
#    If user picks "No", use the other workspace AND ask:
#      "Want to switch your active workspace to {other_workspace} for this session?"
# 3. Fallback: query Supabase for the first workspace
import os
_ws_path = os.path.expanduser("~/.claude/state/active-workspace.json")
WORKSPACE_ID = None
WORKSPACE_NAME = None
if os.path.exists(_ws_path):
    with open(_ws_path) as _f:
        _ws_data = json.load(_f)
        WORKSPACE_ID = _ws_data.get("workspace_id")
        WORKSPACE_NAME = _ws_data.get("workspace_name")
if not WORKSPACE_ID:
    _req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/workspaces?select=id,name&limit=1",
        headers={**headers, "Prefer": ""},
    )
    _resp = urllib.request.urlopen(_req, timeout=10)
    _ws = json.loads(_resp.read().decode())[0]
    WORKSPACE_ID = _ws["id"]
    WORKSPACE_NAME = _ws["name"]

# Before creating the project, evaluate whether it clearly belongs in a different
# workspace based on the project topic/category. If it does, use AskUserQuestion
# to confirm. See the resolution logic above.

project = {
    "name": "<Project Name — concise, descriptive>",
    "description": "<2-3 sentence scope. What does this project accomplish? What areas does it cover?>",
    "status": "active",
    "project_type": "feature",  # "feature" (default) or "system" (platform health/brain/agents/infra)
    "category": "<engineering|design|security|marketing|agent-system|operations>",
    "workspace_id": WORKSPACE_ID,
    # PRD from Steps 2 + 2b — always include for projects with 3+ tasks
    "prd_content": "<merged PRD markdown from SAGE/DELV draft + NOIR/SCAN review>",
    "prd_metadata": {
        "author": "sage",  # lead author is always SAGE (PM)
        "status": "review",  # draft (still iterating) | review (has open questions) | approved (aligned)
        "agents_involved": ["sage", "delv", "noir", "scan"],  # all agents who contributed
        "created_date": "<YYYY-MM-DD>",
    },
}

req = urllib.request.Request(
    f"{SUPABASE_URL}/rest/v1/projects",
    data=json.dumps(project).encode(),
    headers=headers,
    method="POST"
)
resp = urllib.request.urlopen(req, timeout=10)
result = json.loads(resp.read().decode())
proj = result[0] if isinstance(result, list) else result
PROJECT_ID = proj["id"]
```

### Step 3b: Create PRD Task

**ALWAYS** create a "Create a PRD" task for every project. If the project already has `prd_content` (from Steps 2/2b), create the task as **done** immediately — this gives the kanban a complete record of all work.

````python
has_prd = bool(project.get("prd_content"))

prd_task = {
    "title": "Create a PRD",
    "description": """## What
Produce a Product Requirements Document through collaborative R&D.

## Approach
1. **SAGE + DELV draft**: Research the problem space, synthesize into structured PRD (Problem Statement, Goals, Non-Goals, Requirements, User Stories, Success Metrics).
2. **NOIR + SCAN review**: Design reviews interaction patterns, Code Reviewer flags technical concerns. Each fills their section.
3. **Merge feedback**: Incorporate all reviewer input, log unresolved questions.
4. **Upload PRD**: PUT to `/api/projects/{project_id}` with `prd_content` (markdown) and `prd_metadata` (author, status, agents_involved, created_date).
5. **Mark this task done**: Once PRD is uploaded and visible in the admin UI.

## PRD Template
```markdown
## Problem Statement
## Research & Discovery
  ### User Insights
  ### Competitive Landscape
  ### Technical Landscape
## Goals
## Non-Goals
## Edge Cases & Failure Modes
## Requirements
  ### Functional
  ### Non-Functional
  ### User Stories
## Design Direction
## Technical Approach
## Open Questions & Decisions
## Success Metrics
````

## Agent Assignment

| Phase  | Agents     | Focus                        |
| ------ | ---------- | ---------------------------- |
| Draft  | SAGE, DELV | Requirements + Research      |
| Review | NOIR, SCAN | Design + Code Review         |
| Upload | RICK       | API call to project endpoint |

## Blockers

None — agents can start immediately.""",
"priority": "high",
"status": "done" if has_prd else "inbox",
"assignee": "sage",
"project_id": PROJECT_ID,
"category": ["engineering"],
"metadata": {"sprint": 0},
}

# If PRD already exists, mark completed

if has_prd:
prd_task["completed_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
prd_task["outcome"] = "PRD was created during project setup (Steps 2/2b)."

req = urllib.request.Request(
f"{SUPABASE_URL}/rest/v1/tasks",
data=json.dumps(prd_task).encode(),
headers=headers,
method="POST"
)
resp = urllib.request.urlopen(req, timeout=10)
result = json.loads(resp.read().decode())
PRD_TASK = result[0] if isinstance(result, list) else result
PRD_TASK_ID = PRD_TASK["id"]

````

Once the PRD is complete and uploaded, the remaining tasks (Step 4) are built from it and go into Sprint 1+.

### Step 4: Create Tasks

For each workstream/gap, create a task linked to the project.

**Task Description Format:**

Use the full structured format. Be dynamic — include sections that add value, skip ones that don't apply. Every task MUST have at minimum `## What` and `## Approach`. The rest are strongly encouraged.

```markdown
## What
One to three sentences scoping exactly what changes. Be concrete — name files, APIs, components.

## Problem Statement
(Include when there's a clear user pain point or system failure driving this work)
What's broken, frustrating, or missing from the user/operator perspective. Ground it in observable symptoms.

## Value
Why this matters. Who benefits and how. Connect to business goals, user experience, or system reliability.

## Approach
Numbered steps to implement:
1. Step one (specific file, command, or action)
2. Step two
3. ...

## Sequence
Dependencies and ordering constraints:
- What must happen before this task can start
- What this task unblocks
- Or "No dependencies — can start immediately"

## Blockers
- "None — ready to go." if an agent can complete autonomously
- "The user — <specific decision or resource needed>" if blocked
````

**Adapting to task type:**

- **Bug fix**: Emphasize `## Problem Statement` with reproduction steps, include `## What` and `## Approach`
- **Feature**: Emphasize `## Value` and `## Sequence`, include full `## Approach`
- **Infrastructure/chore**: May skip `## Problem Statement`, keep `## What`, `## Approach`, `## Sequence`
- **Research/spike**: May have a lighter `## Approach` focused on what to investigate, not implement

**Task Properties:**

- `title`: Clear, actionable title (verb + noun)
- `priority`: urgent | high | normal | low
- `status`: inbox
- `assignee`: Use pod-aware delegation (see below) | unassigned (if blocked by the user)
- `project_id`: The project ID from Step 3
- `category`: Array of tags from [engineering, security, dx, testing, performance, seo, marketing, analytics, agent-system, design, monitoring, cost-optimization, career, brand, relationships, growth]
- `metadata`: Include `{"sprint": N}` where N groups related tasks. Sprint 0 = PRD task, Sprint 1+ = implementation tasks derived from the PRD. Group tasks into sprints by dependency/phase.

**Pod-Aware Assignee Selection:**

Assign tasks to the head agent whose domain matches:

| Domain                                           | Assignee      |
| ------------------------------------------------ | ------------- |
| Product strategy, roadmap, PRDs, content         | `sage` (SAGE) |
| Architecture, code, engineering, infra, security | `rick` (RICK) |
| UX/UI, design system, prototyping                | `noir` (NOIR) |
| Code review, QA, testing                         | `scan` (SCAN) |
| Web research, competitive analysis               | `delv` (DELV) |
| Career strategy, networking                      | `trek` (TREK) |
| Personal brand, social media                     | `echo` (ECHO) |
| CRM, follow-ups                                  | `bond` (BOND) |
| Goals, habits, wellness                          | `vita` (VITA) |
| Cross-domain, ambiguous                          | `rick`        |

Default to `rick` only when the task spans multiple domains or doesn't clearly map to a single head.

**Create tasks in batch:**

**IMPORTANT:** Every task MUST include `workspace_id` and `user_id` — tasks without `workspace_id` are invisible in the workspace-scoped UI.

```python
tasks = [
    {
        "title": "...",
        "description": "## What\n...\n\n## Value\n...\n\n## Approach\n...\n\n## Sequence\n...\n\n## Blockers\n...",
        "priority": "...",
        "status": "inbox",
        "assignee": "...",
        "project_id": PROJECT_ID,
        "workspace_id": WORKSPACE_ID,  # REQUIRED — tasks without this are invisible in UI
        "user_id": USER_ID,
        "category": [...],
    },
    # ... more tasks
]

created = []
created_task_rows = []  # collect for dependency wiring in Step 4b
for t in tasks:
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/tasks",
        data=json.dumps(t).encode(),
        headers=headers,
        method="POST"
    )
    resp = urllib.request.urlopen(req, timeout=10)
    result = json.loads(resp.read().decode())
    task_row = result[0] if isinstance(result, list) else result
    created_task_rows.append(task_row)
    status_label = "READY" if t["assignee"] == "rick" else "BLOCKED BY USER"
    created.append(f"[{status_label:15s}] [{t['priority']:6s}] {task_row['id'][:8]}  {t['title']}")

print(f"\nCreated {len(created)} tasks:")
for c in created:
    print(c)
```

### Step 4b: Create Required Closing Tasks

After all implementation tasks, ALWAYS create these three closing tasks at the END of the task list. They are non-negotiable — every project gets them.

**UI Detection Logic:**

Before creating closing tasks, determine whether the project has user-facing UI changes:

```python
import re

# Keywords that indicate UI/frontend work
UI_CATEGORIES = {"design", "frontend", "ui"}
UI_KEYWORDS = re.compile(
    r"component|page|dashboard|styling|layout|form|modal|navigation|responsive|accessibility|theme|css|tailwind",
    re.IGNORECASE,
)
PRD_UI_KEYWORDS = re.compile(
    r"user-facing|ui change|frontend|design system|visual|interaction",
    re.IGNORECASE,
)

has_ui_changes = False

# Check task categories, titles, and descriptions
for t in tasks:
    cats = t.get("category", []) or []
    if any(c in UI_CATEGORIES for c in cats):
        has_ui_changes = True
        break
    if UI_KEYWORDS.search(t.get("title", "") + " " + t.get("description", "")):
        has_ui_changes = True
        break

# Check project description / PRD
if not has_ui_changes:
    proj_text = project.get("description", "") + " " + project.get("prd_content", "")
    if PRD_UI_KEYWORDS.search(proj_text):
        has_ui_changes = True
```

**Task 1: Code Review**

````python
code_review_task = {
    "title": "Code review and QA",
    "description": """## What
Comprehensive code review and quality assurance pass across all changes in this project.

## Approach
1. Review every PR/commit from this project for correctness, security, and code quality.
2. Run the full test suite (`pnpm test`) — all tests must pass.
3. Manual QA walkthrough of all user-facing changes (test happy paths AND edge cases).
4. Check for regressions in adjacent features that may have been affected.
5. Verify no hardcoded secrets, no console.logs left in, no TODO hacks shipped.
6. Run `npx prettier --check .` and fix any formatting issues.
7. **Auto-create and execute fix tasks** for every issue found — create a Supabase task with `--spawned-by <this-task-id>`, then implement the fix immediately. Do NOT just report issues — fix them.
8. Re-run verification after all fixes pass.

## Writing Results
**IMPORTANT:** Write all findings to the task's `outcome` field, NOT `description`. The description contains the instructions — the outcome contains the results.
```bash
node packages/db/scripts/task-cli.mjs update <task-id> --outcome "## Findings\\n..."
````

## Value

Catches bugs before they reach production. Maintains codebase quality bar. Fixes are applied inline — no manual triage needed.

## Sequence

- Blocked by: all implementation tasks in this project
- Must complete before: Project Retro

## Blockers

None — SCAN can complete autonomously once all implementation tasks are done.""",
"priority": "high",
"status": "inbox",
"assignee": "scan",
"project_id": PROJECT_ID,
"category": ["testing"],
"metadata": {"sprint": max_impl_sprint + 1}, # closing sprint = max implementation sprint + 1
}

````

**Task 2: Design Feedback**

```python
design_feedback_task = {
    "title": "Design feedback",
    "description": """## What
UX quality assurance pass reviewing all user-facing changes against the PRD.

## Approach
1. Review all implementation task outcomes and code changes — focus on user-facing files.
2. Check experience against PRD:
   - **Visual Review**: design tokens, spacing, typography, dark mode, responsive.
   - **UX Review**: flow, loading/error/empty states, keyboard nav, ARIA.
   - **PRD Compliance**: every UI requirement has implementation.
3. Write structured Design Feedback document.
4. Post as comment: `node packages/db/scripts/task-cli.mjs comment <task-id> --author noir --content "..."`
5. Write to outcome field.
6. Present suggestions to the user via AskUserQuestion:
   - "Auto-implement all" → create + execute fix tasks
   - "Let me review" → show list, the user approves/rejects each
   - "Skip design fixes" → proceed to retro
7. For approved edits: create tasks with `--spawned-by`, auto-implement.
8. Re-verify visual correctness after fixes.
9. Log to `memory/design-feedback-log.md`.
10. Complete task.

## Value
Catches UX/design issues before retro. Ensures user-facing output matches PRD requirements. Prevents design debt from accumulating.

## Sequence
- Blocked by: Code Review task (must complete first)
- Must complete before: Project Retro

## Blockers
None — NOIR can complete autonomously once code review is done.""",
    "priority": "high",
    "assignee": "noir",
    "project_id": PROJECT_ID,
    "category": ["design"],
    "metadata": {"sprint": max_impl_sprint + 1},  # closing sprint = max implementation sprint + 1
}

# Auto-skip if no UI changes detected
if not has_ui_changes:
    import datetime
    design_feedback_task["status"] = "done"
    design_feedback_task["completed_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    design_feedback_task["outcome"] = "No UI/frontend changes detected — project contains only backend/API work. Auto-skipped."
else:
    design_feedback_task["status"] = "inbox"
````

**Task 3: Project Retro**

````python
retro_task = {
    "title": "Project retrospective",
    "description": """## What
Multi-agent retrospective reviewing the PRD, code review findings, and overall project execution. This is a structured conversation between all agents who contributed to the project.

## Approach
1. **Gather context**: Read the PRD, code review findings, and all task descriptions/comments from this project.
2. **Run the retro as a conversation** between all contributing agents (SAGE, NOIR, SCAN, DELV, etc.):
   - Each agent shares their perspective on what went well and what didn't from their domain.
   - Identify communication gaps, unclear requirements, missed edge cases, scope creep.
3. **Produce a structured retro doc** in this EXACT order and **write it to the task's `outcome` field** (NOT description — description has the instructions):
   - **Pros**: What went well — decisions, patterns, collaboration moments that worked.
   - **Cons**: What went poorly — blockers, rework, miscommunication, quality issues.
   - **Log feedback in each agent's memory**: Every participating agent updates their memory file (`.claude/agents/{name}/CLAUDE.md` or memory dir) with the lessons learned, specifically what they should do differently, what worked well, and notes on collaborating with other agents.
   - **Action Items** (ALWAYS the last section): Concrete, numbered solutions for how agents can work better together on the next project. Each item should be specific and actionable.

   Save the retro doc to outcome:
   ```bash
   node packages/db/scripts/task-cli.mjs update <task-id> --outcome "<full retro markdown>"
````

4. **Create follow-up tasks** for each action item using the CLI with `--spawned-by` linking back to this retro task. Place them in the **inbox** so they're visible on the kanban.

   ```bash
   node packages/db/scripts/task-cli.mjs create \
     --title "Action item title (≤70 chars)" \
     --description "Description linking back to retro findings" \
     --project <this-project-id> \
     --priority <normal|high> \
     --assignee <agent-id> \
     --category agent-system \
     --status inbox \
     --spawned-by <this-retro-task-uuid>
   ```

5. **Post retro summary** as a comment on this task.
6. **Auto-execute all retro improvement tasks.** After creating improvement tasks, immediately execute them:
   - If 1-2 tasks: execute inline (claim → implement → verify → complete) sequentially
   - If 3+ tasks: spawn sub-agents with `run_in_background: true` for parallelism
   - This is the default behavior. In the future, this will be configurable per-org/workspace (auto-execute, move to EOW cleanup, or manual triage). Until that setting exists, always auto-execute.

## Value

Continuous improvement loop. Agents learn from each project and get better at collaborating. Prevents the same mistakes from repeating across projects. Auto-executing retro items ensures improvements actually get built — not just logged.

## Sequence

- Blocked by: Code Review task (must complete first so retro can review its findings)
- This is always the LAST task in any project.

## Blockers

None — agents can complete autonomously once code review is done.""",
"priority": "normal",
"status": "inbox",
"assignee": "sage",
"project_id": PROJECT_ID,
"category": ["agent-system"],
"metadata": {"sprint": max_impl_sprint + 1}, # closing sprint = max implementation sprint + 1
}

````

**Compute `max_impl_sprint`** before creating closing tasks:
```python
max_impl_sprint = max((t.get("metadata", {}).get("sprint", 0) for t in created_task_rows), default=0)
# PRD task is sprint 0, impl tasks are sprint 1+, closing tasks are max + 1
````

Create all three in order, then **wire dependencies** so the kanban reflects the real execution order:

```python
# Collect all implementation task IDs (from Step 4 batch creation above)
impl_task_ids = [t["id"] for t in created_task_rows]  # populated during Step 4 loop

# --- Code Review: depends on ALL implementation tasks ---
code_review_task["depends_on"] = impl_task_ids

req = urllib.request.Request(
    f"{SUPABASE_URL}/rest/v1/tasks",
    data=json.dumps(code_review_task).encode(),
    headers=headers,
    method="POST"
)
resp = urllib.request.urlopen(req, timeout=10)
result = json.loads(resp.read().decode())
cr_row = result[0] if isinstance(result, list) else result
CR_TASK_ID = cr_row["id"]
created.append(f"[{'READY':15s}] [{code_review_task['priority']:6s}] {cr_row['id'][:8]}  {code_review_task['title']}")

# --- Design Feedback: depends on Code Review ---
design_feedback_task["depends_on"] = [CR_TASK_ID]

req = urllib.request.Request(
    f"{SUPABASE_URL}/rest/v1/tasks",
    data=json.dumps(design_feedback_task).encode(),
    headers=headers,
    method="POST"
)
resp = urllib.request.urlopen(req, timeout=10)
result = json.loads(resp.read().decode())
df_row = result[0] if isinstance(result, list) else result
DF_TASK_ID = df_row["id"]
skip_label = "SKIPPED" if not has_ui_changes else "READY"
created.append(f"[{skip_label:15s}] [{design_feedback_task['priority']:6s}] {df_row['id'][:8]}  {design_feedback_task['title']}")

# --- Retro: depends on Design Feedback ---
retro_task["depends_on"] = [DF_TASK_ID]

req = urllib.request.Request(
    f"{SUPABASE_URL}/rest/v1/tasks",
    data=json.dumps(retro_task).encode(),
    headers=headers,
    method="POST"
)
resp = urllib.request.urlopen(req, timeout=10)
result = json.loads(resp.read().decode())
retro_row = result[0] if isinstance(result, list) else result
created.append(f"[{'READY':15s}] [{retro_task['priority']:6s}] {retro_row['id'][:8]}  {retro_task['title']}")
```

**IMPORTANT:** The `impl_task_ids` list must be populated during the Step 4 batch creation loop. Update that loop to collect the IDs:

```python
created_task_rows = []  # ← add this before the loop
for t in tasks:
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/tasks",
        data=json.dumps(t).encode(),
        headers=headers,
        method="POST"
    )
    resp = urllib.request.urlopen(req, timeout=10)
    result = json.loads(resp.read().decode())
    task_row = result[0] if isinstance(result, list) else result
    created_task_rows.append(task_row)  # ← collect the row
    status_label = "READY" if t["assignee"] == "rick" else "BLOCKED BY USER"
    created.append(f"[{status_label:15s}] [{t['priority']:6s}] {task_row['id'][:8]}  {t['title']}")

print(f"\nCreated {len(created)} tasks:")
for c in created:
    print(c)
```

### Step 5: Summary Report

Present the user with:

1. **Knowledge saved** — vault path (if any)
2. **Project created** — name, description, ID
3. **PRD status** — Always show PRD status prominently. New projects start as `review`:
   > ⚠️ **PRD status: `review`** — AFK/autonomous skills will skip this project until you approve the PRD.
   > To enable autonomous building: `/build <project-id>` (auto-approves) or manually set `prd_metadata.status = "approved"` in Supabase.
4. **Tasks created** — table:

| #   | Task | Priority | Status          | Category    |
| --- | ---- | -------- | --------------- | ----------- |
| 1   | ...  | high     | READY           | engineering |
| 2   | ...  | normal   | BLOCKED BY USER | security    |

4. **Blockers requiring the user's input** — numbered list of specific decisions/actions needed
5. **Recommended sequencing** — what to tackle first and why
6. **Estimated scope** — rough sense of total effort (small/medium/large per task)

## Conventions

- **All tasks start as `inbox`.** Never create tasks as `planning`, `in_progress`, or `done` (exception: PRD task is `done` if PRD already exists, and Design Feedback is `done` if auto-skipped). The project must be reviewed before `/build` moves tasks through the pipeline. This review confirms: PRD exists, closing tasks are in place, all tasks have proper descriptions, assignees, and details.
- **Ready tasks** (assignee=rick): RICK can complete autonomously. No user input needed.
- **Blocked tasks** (assignee=unassigned): the user must make a decision, provide credentials, choose a service, etc. Describe exactly what's needed in the ## Blocked By section.
- **Priority mapping:**
  - urgent: Security vulnerability or production issue
  - high: Significant gap affecting quality or reliability
  - normal: Good improvement, no urgency
  - low: Nice-to-have, stretch goal
- Always use the `## What / ## Value / ## Approach / ## Sequence / ## Blockers` description format (adapt sections to task type)
- Always associate every task with the project via `project_id`
- Always add category tags for filtering
- Use parallel agents for research when scope covers multiple domains
- Aim for 5-15 tasks per project — if more, consider splitting into multiple projects
- Order tasks by dependency and priority in the summary (what to do first)

## Project Types

Projects have a `project_type` field: `feature` (default), `system`, `research`, or `plan`.

- **Feature projects** (`feature`): Full lifecycle — PRD, impl tasks, CR -> DF -> Retro. Created via `/project`. Shown in "Features" tab.
- **System projects** (`system`): Platform health, brain, agents, and infra. Same closing gates as feature. Shown in "System" tab.
- **Research projects** (`research`): Q&A intake, research tasks, Retro -> Research Deliverable. No PRD/CR/DF. Created via `/project-research`. Shown in "Research" tab.
- **Plan projects** (`plan`): Full lifecycle (same as feature) — PRD, impl tasks, CR -> DF -> Retro. Created via `/project-plan`. Shown in "Plans" tab. Good for roadmaps, initiatives, non-code planning.

### Weekly "End of Week Cleanup" Pattern

Every Monday, a new system project should be created for the week. This is the accumulation bucket for:

- Retro action items from completed feature projects
- Agent feedback and process improvements
- Technical debt and code quality fixes
- Housekeeping tasks that can run overnight

**Naming convention:** `End of Week Cleanup — Week of Mar 3`

**To find or create this week's cleanup project:**

```python
# Calculate Monday of current week
import datetime
today = datetime.date.today()
monday = today - datetime.timedelta(days=today.weekday())
week_label = monday.strftime("%b %-d")
project_name = f"End of Week Cleanup — Week of {week_label}"

# Check if it already exists
req = urllib.request.Request(
    f"{SUPABASE_URL}/rest/v1/projects?project_type=eq.system&name=eq.{urllib.parse.quote(project_name)}",
    headers={**headers, "Prefer": ""},
)
resp = urllib.request.urlopen(req, timeout=10)
existing = json.loads(resp.read().decode())

if existing:
    PROJECT_ID = existing[0]["id"]
else:
    # Create it
    project = {
        "name": project_name,
        "description": f"Weekly system tasks from retro action items, agent feedback, and platform cleanup for the week of {week_label}.",
        "status": "active",
        "project_type": "system",
        "category": "agent-system",
    }
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/projects",
        data=json.dumps(project).encode(),
        headers=headers,
        method="POST"
    )
    resp = urllib.request.urlopen(req, timeout=10)
    result = json.loads(resp.read().decode())
    proj = result[0] if isinstance(result, list) else result
    PROJECT_ID = proj["id"]
```

This pattern is used by:

1. **Retro follow-up tasks** — created via CLI with `--spawned-by`, tasks route to this week's cleanup project
2. **`/afk-housekeeping`** and **`/afk-nightwatch`** — these pick up `planning` status tasks from system projects for overnight work
3. **Manual creation** — the user or RICK can create tasks directly in the system project

## Relationship to /task

- `/task` creates individual standalone tasks (no project wrapper)
- `/project` creates a project AND populates it with tasks
- If the user asks for "a task" → use `/task`
- If the user asks to "plan out", "build a project for", or describes a multi-step initiative → use `/project`
