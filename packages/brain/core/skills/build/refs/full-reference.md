---
name: build
description: "Execute a project or task end-to-end with full build lifecycle.\n  TRIGGER when: the user says '/build', 'build this project', 'execute this', or provides a project/task UUID to build. Handles validation, orchestration, sprint execution, and closing gates.\n  DO NOT TRIGGER when: creating a project (/project-plan), creating tasks (/task), daily planning (/todays-project), or overnight autonomous work (/afk-building)."
user_invocable: true
requires:
  bins: [node, pnpm]
---

# /build — Execute a Project or Task End-to-End

The unified execution engine. Takes a project or task, validates everything is standardized and ready, fills in gaps, intelligently chooses HOW to execute (solo, sub-agents, or full agent team), and runs the full sprint-based build lifecycle through delivery.

Fuses `/project-plan` (planning/creation) with `/afk-building` (single-task execution) into one skill.

## Arguments

`/build <project URL | project UUID | task UUID | natural language with optional orchestration override>`

Examples:
- `/build /projects/abc-123` — build entire project
- `/build abc-123` — query Supabase, determine if project or task
- `/build an agent team to implement the auth system` — explicit team override
- `/build this yourself` — explicit solo override

---

## Phase 0: Input Parsing & Mode Detection

Parse the argument to determine what we're building.

```python
import json, urllib.request, re

env_file = "$CELUNE_REPO/apps/admin/.env.local"
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
```

**Input resolution order:**

1. **Project URL** (`/projects/<uuid>`) → extract UUID, set `mode = "project"`
2. **Raw UUID** → query both `projects` and `tasks` tables to identify which it is
3. **Task UUID with `project_id`** → ask the user: "Build the full project or just this task?"
4. **Task UUID without `project_id`** → set `mode = "single-task"`
5. **Natural language** → check for orchestration override keywords (Phase 2b), then determine if it references an existing project/task or is a new request (error — use `/project-plan` first)

```python
# Resolve UUID to project or task
uuid_pattern = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
match = uuid_pattern.search(user_input)

if match:
    uuid = match.group(0)
    # Try projects first
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/projects?id=eq.{uuid}&select=*",
        headers={**headers, "Prefer": ""},
    )
    resp = urllib.request.urlopen(req, timeout=10)
    projects = json.loads(resp.read().decode())

    if projects:
        PROJECT = projects[0]
        mode = "project"
    else:
        # Try tasks
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/tasks?id=eq.{uuid}&select=*",
            headers={**headers, "Prefer": ""},
        )
        resp = urllib.request.urlopen(req, timeout=10)
        tasks = json.loads(resp.read().decode())
        if tasks:
            TASK = tasks[0]
            if TASK.get("project_id"):
                # Ask the user: full project or just this task?
                mode = "ask"  # use AskUserQuestion
            else:
                mode = "single-task"
        else:
            # UUID not found
            raise ValueError(f"UUID {uuid} not found in projects or tasks")
```

For **project mode**, fetch all tasks:
```python
if mode == "project":
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/tasks?project_id=eq.{PROJECT['id']}&select=*&order=created_at.asc",
        headers={**headers, "Prefer": ""},
    )
    resp = urllib.request.urlopen(req, timeout=10)
    ALL_TASKS = json.loads(resp.read().decode())
```

---

## Phase 0b: Project Consolidation Check

Before building, check for active projects that overlap with the target project. This prevents building on a fragmented task board when consolidation would produce better sequencing and context handoff.

```python
# Fetch all active projects (excluding the current one)
req = urllib.request.Request(
    f"{SUPABASE_URL}/rest/v1/projects?status=eq.active&id=neq.{PROJECT['id']}&select=id,name,description,project_type,category",
    headers={**headers, "Prefer": ""},
)
resp = urllib.request.urlopen(req, timeout=10)
active_projects = json.loads(resp.read().decode())
```

**For each active project, check for overlap by:**
1. **Name/description similarity** — Does the existing project cover the same domain or feature area as the build target?
2. **Task overlap** — Fetch tasks for candidate projects. Do any tasks duplicate tasks in the build target?
3. **Dependency relationship** — Should one project's tasks block or sequence after the other?

**When overlap is found, present a Consolidation Report to the user:**

```
## Consolidation Check

Found overlap between "{build_target_name}" and {N} active project(s):

| Project | Overlap | Recommendation |
|---------|---------|---------------|
| {name} ({id}) | {description of overlap} | Absorb / Sequence / Independent |

Options:
  1. "Absorb overlapping tasks" — Merge tasks from the other project into this one as additional sprints
  2. "Sequence projects" — Build this one first, note dependency for the other
  3. "Proceed as-is" — No changes, build independently
```

**If absorbing:**
- Move overlapping tasks from the other project into this project (update `project_id`)
- Assign them appropriate sprint numbers in this project's sequence
- Update the PRD to reflect expanded scope
- Consider archiving the other project if all its tasks were absorbed

**If sequencing:**
- Note the dependency in both projects' PRDs
- Ensure the build order respects the dependency (e.g., build security foundation before feature work)

**If no overlap found or the user chooses to proceed:** Continue to Phase 1.

This check catches situations like: an RBAC project with 7 tasks that duplicates work in a broader "External User Readiness" project, or a "Landing Page" project that overlaps with a "Marketing Site" project.

---

## Phase 0c: PRD Approval Gate

**Skip if `project_type == 'research'` or `mode == 'single-task'`.**

Check `prd_metadata.status` on the project before any validation or execution begins.

```python
prd_meta = PROJECT.get("prd_metadata") or {}
prd_status = prd_meta.get("status", "draft")
project_type = PROJECT.get("project_type", "feature")

if project_type != "research" and mode == "project":
    if prd_status != "approved":
        # Explicit /build invocation → auto-approve and proceed
        import datetime
        updated_meta = {**prd_meta, "status": "approved", "approved_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "approved_by": "rick"}
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/projects?id=eq.{PROJECT['id']}",
            data=json.dumps({"prd_metadata": updated_meta}).encode(),
            headers={**headers, "Prefer": "return=minimal"},
            method="PATCH"
        )
        urllib.request.urlopen(req, timeout=10)
        print(f"PRD auto-approved: status was '{prd_status}', set to 'approved' (explicit /build invocation).")
        prd_status = "approved"
    # else: already approved, proceed
```

> **Trust boundary:** Invoking `/build` explicitly is the user's signal that the PRD is good to go. AFK/autonomous modes are NOT allowed to auto-approve — they must skip unapproved projects entirely. See `/afk-building` and `/afk-nightwatch` for the AFK-side filtering.

---

## Phase 1: Validate & Standardize (6 checks, auto-fix)

Before any code is written, run the Build Readiness Checklist. Each check either passes or is auto-fixed. Present the results as a **Build Readiness Report**.

### Per-Type Check Matrix

| Check | Feature | System | Plan | Research |
|-------|---------|--------|------|----------|
| PRD | Required | Optional | Required | Skip |
| CR | Required | Required | Required | Skip |
| DF | Required | Required | Required | Skip |
| Retro | Required | Required | Required | Required |
| Research Deliverable | Skip | Skip | Skip | Required |

Determine the project type from `PROJECT.get("project_type", "feature")` and use this matrix for all checks below. Feature, System, and Plan all share the full closing sequence (CR → DF → Retro). Research is the only type with a reduced lifecycle.

### Check 1: PRD

**Skip if `project_type == 'research'`.**

`prd_content` is populated on the project OR a "Create a PRD" task exists.

> **Note:** `/project-plan` now always creates a PRD task at creation time (auto-completed if `prd_content` exists). This check is a safety net for projects created before that change or via direct Supabase inserts.

**Auto-fix:** Create a PRD task (sprint 0) using the template from `/project-plan` Step 3b:
```bash
node packages/db/scripts/task-cli.mjs create \
  --title "Create a PRD" \
  --description "## What\nProduce a Product Requirements Document through collaborative R&D.\n\n## Approach\n1. SAGE + DELV draft: Research → structured PRD.\n2. NOIR + SCAN review: Design + Code Review feedback.\n3. Merge feedback, log unresolved questions.\n4. Upload PRD to project via API.\n5. Mark this task done.\n\n## Blockers\nNone — agents can start immediately." \
  --project PROJECT_ID \
  --priority high \
  --assignee sage \
  --category engineering \
  --status inbox
```
Then set `metadata.sprint = 0` on the created task.

### Check 2: Closing Tasks

Required closing tasks vary by project type:

- **Feature/System/Plan**: "Code review and QA", "Design feedback", AND "Project retrospective"
- **Research**: "Project retrospective" AND "Research deliverable: {output_type}"

**Auto-fix:** Create missing closing tasks using the appropriate templates. All get `metadata.sprint = max_impl_sprint + 1` (the next sprint after the highest implementation sprint). For Feature/System/Plan Design Feedback, run the UI detection logic from `/project-plan` Step 4b to determine if it should be auto-completed (no UI changes) or left as `inbox`. For Research, create the Research Deliverable task from `/project-research` Step 3.

### Check 3: Task Descriptions

All tasks have at minimum `## What` and `## Approach` sections.

**Auto-fix:** For tasks missing the structured format:
1. Preserve the original description as a comment: `<!-- Original: ... -->`
2. Rewrite into structured format inferring `## What` and `## Approach` from the existing text
3. Update via: `node packages/db/scripts/task-cli.mjs update <id> --description "..."`

### Check 4: Assignees

No tasks have `assignee = "unassigned"` (unless blocked by the user).

**Auto-fix:** Infer assignee from the pod delegation table:

| Domain | Assignee |
|--------|----------|
| Product strategy, roadmap, PRDs, content | SAGE |
| Architecture, code, engineering, infra, security | `rick` |
| UX/UI, design system, prototyping | NOIR |
| Code review, QA, testing | SCAN |
| Web research, competitive analysis | DELV |
| Career strategy, networking | TREK |
| Personal brand, social media | ECHO |
| CRM, follow-ups | BOND |
| Goals, habits, wellness | VITA |
| Cross-domain, ambiguous | `rick` |

Update via: `node packages/db/scripts/task-cli.mjs update <id> --assignee <agent-id>`

### Check 5: Sprint Metadata

All tasks have `metadata.sprint` set.

**Auto-fix:** Assign sprints via topological sort of the `depends_on` graph:
- Sprint 0 = PRD task
- Sprint 1+ = implementation tasks, grouped by dependency layer
- Closing sprint (max impl + 1) = closing tasks (Code Review, Design Feedback, Retro)
- Tasks with no dependencies start at Sprint 1
- Tasks depending on Sprint N tasks go to Sprint N+1

Update via: `node packages/db/scripts/task-cli.mjs update <id> --metadata '{"sprint": N}'`

### Check 6: Dependencies

Dependency chains vary by project type:

- **Feature/System/Plan**: All impl tasks -> Code Review -> Design Feedback -> Retro
- **Research**: All research tasks -> Retro -> Research Deliverable

> **Note:** `/project-plan` now wires `depends_on` at creation time (Step 4b). This check is a safety net for projects created before that change, or when new implementation tasks are added after initial creation.

**Auto-fix:** Set dependencies via:
```bash
# Feature/System/Plan:
node packages/db/scripts/task-cli.mjs update <code-review-id> --depends-on "task1-id,task2-id,..."
node packages/db/scripts/task-cli.mjs update <design-feedback-id> --depends-on "<code-review-id>"
node packages/db/scripts/task-cli.mjs update <retro-id> --depends-on "<design-feedback-id>"

# Research:
node packages/db/scripts/task-cli.mjs update <retro-id> --depends-on "task1-id,task2-id,..."
node packages/db/scripts/task-cli.mjs update <deliverable-id> --depends-on "<retro-id>"
```

### Build Readiness Report

Present results as a table:

```
## Build Readiness Report

| # | Check | Status | Action Taken |
|---|-------|--------|-------------|
| 1 | PRD | PASS / FIXED | Created PRD task (sprint 0) |
| 2 | Closing tasks | PASS / FIXED | Created Code Review + Design Feedback + Retro tasks |
| 3 | Descriptions | PASS / FIXED | Rewrote 3 tasks into structured format |
| 4 | Assignees | PASS / FIXED | Assigned 2 tasks via pod delegation |
| 5 | Sprint metadata | PASS / FIXED | Assigned sprints 1-3 via dependency sort |
| 6 | Dependencies | PASS / FIXED | Set CR → all impl, Design Feedback → CR, Retro → DF |

Skipped (the user-blocked): [list any tasks with assignee=unassigned that need the user's input]
```

---

## Phase 2: Orchestration Mode Selection

The intelligence layer. Score the project/task to determine the right execution mode.

### Step 2a: Compute Scope Signals

| Signal | How to Measure |
|--------|---------------|
| Task count | Number of non-closing, non-PRD (sprint != 0) implementation tasks |
| Sprint count | Number of distinct sprint values (excluding 0 and the closing sprint) |
| Domain spread | Number of unique assignee agent IDs across impl tasks |
| Code vs docs | Ratio of implementation tasks vs documentation/research tasks |
| Dependency depth | Longest chain in the `depends_on` graph |
| Estimated effort | S/M/L/XL per task based on description complexity and approach step count |

Effort heuristic:
- **S** (Small): ≤3 approach steps, single file, no DB changes
- **M** (Medium): 4-6 approach steps, 2-4 files, minor DB changes
- **L** (Large): 7-10 approach steps, 5-8 files, new tables/APIs
- **XL** (Extra Large): 10+ approach steps, 8+ files, architectural changes

### Step 2b: Check for Explicit Override

If the user's invocation includes orchestration language, override auto-detection:

| User says | Mode |
|-----------|------|
| `an agent team`, `spin up a team`, `use a team`, `full team` | Force **Agent Team** |
| `yourself`, `just do it`, `solo`, `handle this`, `do it directly` | Force **Solo** |
| `with sub-agents`, `delegate this`, `use sub-agents` | Force **Sub-agents** |
| No explicit directive | Auto-detect (Step 2c) |

### Step 2c: Auto-Select Orchestration Mode

| Mode | When | Pattern |
|------|------|---------|
| **Solo** (RICK directly) | 1-5 impl tasks, all effort ≤ L | Execute directly, no delegation overhead |
| **Sub-agents** | 6-8 impl tasks OR tasks that are XL, ≤3 sprints | Spawn via Agent tool with `run_in_background: true`, worktree isolation for parallel code writers |
| **Agent Team** | 9+ impl tasks OR 4+ sprints OR 4+ domains OR explicit override | TeamCreate, full sprint-by-sprint orchestration with SendMessage coordination |

**Decision tree:**
```
Is there an explicit override? → Use that mode
Else:
  impl_tasks ≤ 5 AND all effort ≤ L → Solo
  impl_tasks ≤ 8 AND sprints ≤ 3 → Sub-agents
  Otherwise → Agent Team
```

### Step 2d: Model Tiering Per Task

Use these tiers:

| Tier | Model | Use For |
|------|-------|---------|
| Tier 1 | Opus | RICK — orchestration, architecture, implementation, security reasoning |
| Tier 2 | Sonnet | SAGE, NOIR, SCAN — product strategy, design, code review |
| Tier 3 | Haiku | DELV, TREK, ECHO, BOND, VITA — research, bounded tasks, formulaic work |

### Step 2e: Present Execution Plan

Show the plan before proceeding:

```
## Execution Plan

**Mode:** Sub-agents (3 impl tasks, 2 sprints, 2 domains)

### Sprint 1 (parallel)
| Task | Assignee | Model | Worktree? | Effort |
|------|----------|-------|-----------|--------|
| Implement auth middleware | RICK | Opus | Yes | L |
| Add security headers | RICK | Opus | Yes | M |

### Sprint 2 (sequential, depends on Sprint 1)
| Task | Assignee | Model | Worktree? | Effort |
|------|----------|-------|-----------|--------|
| Build user settings page | NOIR | Sonnet | No | M |

### Sprint 99 (closing — sequential)
| Task | Assignee | Model | Effort |
|------|----------|-------|--------|
| Code review and QA | SCAN | Sonnet | M |
| Design feedback | NOIR | Sonnet | M |
| Project retrospective | SAGE | Sonnet | M |

Proceeding automatically. Send a message to intervene.
```

---

## Phase 2f: Git Branch Setup

Before execution begins, set up the Git branch for this project. Use workspace `github_settings` for branch naming.

1. **Check workspace repo:** Query the workspace for `repo_url`, `github_installation_id`, and `github_settings`. If no repo is connected, skip Git workflow entirely (local-only build).

2. **Read branch naming convention** from `github_settings.branch_naming`:
   ```python
   settings = workspace.get("github_settings", {})
   naming = settings.get("branch_naming", {
     "prefix": "celune", "separator": "/", "include_assignee": True, "slug_source": "project_name"
   })
   ```

3. **Merged-branch safety check** — Before creating or checking out any branch, verify it hasn't already been merged:
   ```bash
   # If reusing an existing branch, check if it was already merged
   EXISTING_BRANCH="$BRANCH"
   if git show-ref --verify --quiet "refs/heads/$EXISTING_BRANCH" 2>/dev/null; then
     MERGED_PR=$(gh pr list --head "$EXISTING_BRANCH" --state merged --json number --jq '.[0].number' 2>/dev/null)
     if [ -n "$MERGED_PR" ]; then
       echo "Branch '$EXISTING_BRANCH' was already merged via PR #$MERGED_PR."
       echo "Creating a fresh branch from origin/main instead."
       # Append -v2, -v3, etc. to avoid naming collision
       SUFFIX=2
       while git show-ref --verify --quiet "refs/heads/${EXISTING_BRANCH}-v${SUFFIX}" 2>/dev/null; do
         SUFFIX=$((SUFFIX + 1))
       done
       BRANCH="${EXISTING_BRANCH}-v${SUFFIX}"
       git checkout origin/main -b "$BRANCH"
     fi
   fi

   # Also verify the CURRENT branch (if we're on one) isn't merged
   CURRENT=$(git branch --show-current)
   if [ "$CURRENT" != "main" ] && [ -n "$CURRENT" ]; then
     CURRENT_MERGED=$(gh pr list --head "$CURRENT" --state merged --json number --jq '.[0].number' 2>/dev/null)
     if [ -n "$CURRENT_MERGED" ]; then
       echo "Current branch '$CURRENT' was already merged via PR #$CURRENT_MERGED. Switching to origin/main as base."
       git checkout origin/main
     fi
   fi
   ```

4. **Group branch resolution (BEFORE branch creation):** If the project has a `group_id`, resolve the group branch first — it determines the base for the project branch.

   ```python
   group_id = PROJECT.get("group_id")
   GROUP_BRANCH = None
   GROUP = None
   BASE_REF = "origin/main"  # default base

   if group_id:
       req = urllib.request.Request(
           f"{SUPABASE_URL}/rest/v1/project_groups?id=eq.{group_id}&select=*",
           headers={**headers, "Prefer": ""},
       )
       resp = urllib.request.urlopen(req, timeout=10)
       groups = json.loads(resp.read().decode())
       if groups:
           GROUP = groups[0]
           GROUP_NAME = GROUP["name"]
           existing_meta = GROUP.get("metadata") or {}

           if existing_meta.get("branch"):
               # Group already has a branch — auto-use it (no prompt needed)
               GROUP_BRANCH = existing_meta["branch"]
               print(f"Using existing group branch: {GROUP_BRANCH}")
           else:
               # Group has NO branch yet — prompt the user for branch strategy
               # Use AskUserQuestion to let the user decide
               # Options:
               #   1. "Create group branch" — creates group/{name} off main, branches project from it
               #   2. "Branch from main" — skip group branching, PR targets main directly
               #
               # For AFK/autonomous modes: auto-select option 1 (create group branch)
               GROUP_BRANCH = "group/" + GROUP_NAME.lower().replace(" ", "-").replace("/", "-")
               print(f"Group '{GROUP_NAME}' has no branch. Creating: {GROUP_BRANCH}")

           # Ensure the group branch exists on remote
           import subprocess
           check = subprocess.run(
               ["git", "ls-remote", "--heads", "origin", GROUP_BRANCH],
               capture_output=True, text=True
           )
           if not check.stdout.strip():
               # Create the group branch from origin/main
               subprocess.run(
                   ["git", "push", "origin", f"origin/main:refs/heads/{GROUP_BRANCH}"],
                   check=False
               )
               print(f"Created group branch: {GROUP_BRANCH}")

           # Persist branch name in group metadata if not already set
           if not existing_meta.get("branch"):
               req = urllib.request.Request(
                   f"{SUPABASE_URL}/rest/v1/project_groups?id=eq.{group_id}",
                   data=json.dumps({"metadata": {**existing_meta, "branch": GROUP_BRANCH}}).encode(),
                   headers={**headers, "Prefer": "return=minimal"},
                   method="PATCH"
               )
               urllib.request.urlopen(req, timeout=10)
               print(f"Group branch set: {GROUP_BRANCH}")

           # Use group branch as the base for this project's branch
           BASE_REF = f"origin/{GROUP_BRANCH}"
           subprocess.run(["git", "fetch", "origin", GROUP_BRANCH], check=False)
           print(f"Project will branch from group branch: {GROUP_BRANCH}")
   ```

   **Branch strategy prompt (interactive mode only):**
   When the project belongs to a group that has NO existing branch, and this is an interactive `/build` invocation (not AFK/autonomous), use `AskUserQuestion` to ask:

   > This project belongs to group **"{GROUP_NAME}"** which has no branch yet.
   > 1. **Create group branch** — Creates `group/{slug}` off main. This project and future group projects will branch from it. PRs merge into the group branch; a single group PR rolls up to main.
   > 2. **Branch from main** — Skip group branching. PR targets main directly (standard flow).

   If the user picks option 2, set `GROUP_BRANCH = None` and `BASE_REF = "origin/main"`.
   If the group already has a branch, skip the prompt and auto-use it.

   Key rules:
   - If `GROUP_BRANCH` is set, `BASE_REF` becomes `origin/{GROUP_BRANCH}` instead of `origin/main`.
   - Project PRs target the group branch instead of `main`.
   - When creating the PR in the Code Review phase (Sprint 99), pass `--base "$GROUP_BRANCH"` to `gh pr create`.
   - Auto-approve mode and reviewer assignment still apply at the project level — the project-to-group-branch PR does not require the user's mandatory review.
   - The group PR (group branch → main) is the single human review point.

5. **Create or checkout branch** using the convention, branching from `BASE_REF`:
   ```bash
   # Build branch name from settings
   PREFIX=naming["prefix"]
   SEP=naming["separator"]
   ASSIGNEE="rick" if naming["include_assignee"] else ""
   SLUG=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-' | head -c 50)

   if [ -n "$ASSIGNEE" ]; then
     BRANCH="${PREFIX}${SEP}${ASSIGNEE}${SEP}${SLUG}"
   else
     BRANCH="${PREFIX}${SEP}${SLUG}"
   fi

   # Branch from group branch if available, otherwise origin/main
   git checkout -b "$BRANCH" "$BASE_REF" 2>/dev/null || git checkout "$BRANCH"
   ```

6. **Store branch in project metadata** (Supabase REST API):
   ```python
   # Update project metadata with branch name and base reference
   branch_meta = {"branch": BRANCH}
   if GROUP_BRANCH:
       branch_meta["base_branch"] = GROUP_BRANCH
   req = urllib.request.Request(
       f"{SUPABASE_URL}/rest/v1/projects?id=eq.{PROJECT_ID}",
       data=json.dumps({"metadata": {**existing_metadata, **branch_meta}}).encode(),
       headers={**headers, "Prefer": "return=representation"},
       method="PATCH"
   )
   ```

7. **Create project_prs record** when the branch is first pushed:
   - On first `git push`, call `POST /api/github/prs` with:
     ```json
     {
       "workspace_id": "...",
       "project_id": "...",
       "pr_number": <from gh pr create>,
       "pr_url": "...",
       "branch_name": "...",
       "title": "Feat: <project name>",
       "status": "draft",
       "base_branch": "<GROUP_BRANCH or 'main'>"
     }
     ```
   - Respect `github_settings.auto_pr`:
     - `"draft_on_push"`: Create a draft PR automatically on first push
     - `"ready_on_push"`: Create a ready-for-review PR on first push
     - `"off"`: Push the branch but don't create a PR

8. **All commits during execution go to this branch.** Do NOT commit to `main`.

---

## Phase 3: Execute

### Solo Mode

RICK claims and executes each task directly, following the `/afk-building` lifecycle.

**Per task:**

1. **Claim:** `node packages/db/scripts/task-cli.mjs claim <task-id> --agent rick`
2. **RFC (L/XL effort only):** For Large or XL tasks, write a brief RFC (Problem, Solution, Technical Approach, Testing). Post as task comment. Skip for S/M effort tasks — just implement directly.
3. **Execute:** Implement the solution. Commit after each logical unit to the project branch.
4. **Verify:** Run domain-appropriate checks (`pnpm type-check && pnpm build && pnpm test`).
5. **Complete with outcome:** `node packages/db/scripts/task-cli.mjs complete <task-id> --agent rick --outcome "Concise summary of what was built, files changed, and verification results."`

Progress through sprints sequentially. **Compact between sprints** with a handoff summary (completed tasks, remaining tasks, branch, blockers). Use TDD, code-review, and debugging skills as appropriate.

### Sub-agent Mode

For each sprint, spawn Agent tools with `run_in_background: true`.

**Per sprint:**

1. **Spawn agents** for each task in the sprint:
```
Agent tool call:
  subagent_type: "general-purpose"
  name: "<agent-slug>-<task-short-name>"
  model: "<tier-appropriate model>"
  isolation: "worktree"  # when 2+ agents write code in same sprint
  run_in_background: true
  prompt: |
    You are {AGENT_NAME}, working on a platform engineering task.

    ## Identity & Rules
    - You are an autonomous builder. Claim the task, execute, complete it.
    - Follow all conventions in the platform CLAUDE.md.
    - Write clean, typed, secure code. No over-engineering.

    ## Process
    1. Claim: `node packages/db/scripts/task-cli.mjs claim {task_id} --agent {agent_id}`
    2. Read the task description carefully. Write a brief RFC as a task comment.
    3. Implement the solution. Commit after each logical unit.
    4. Verify: `pnpm type-check && pnpm build && pnpm test`
    5. Complete with outcome: `node packages/db/scripts/task-cli.mjs complete {task_id} --agent {agent_id} --outcome "Concise summary of what was built, files changed, and verification results."`
    7. Send a summary message to the team lead with what you built and any issues.

    ## Your Task
    - Supabase Task ID: {task_id}
    - Title: {task_title}
    - Description: {task_description}
    - Sprint: {sprint_number}

    ## Skill References
    - TDD: .claude/skills/tdd/ (if writing tests)
    - Debugging: .claude/skills/debugging/ (if fixing bugs)
    - Context management: .claude/skills/context-management/ (if context grows large)
```

2. **Wait for all sprint agents** to finish (TaskOutput or automatic notifications)
3. **RICK handles merges** between sprints if worktrees were used:
   ```bash
   # For each worktree branch, merge it into the project branch
   MAIN_WD=$(git rev-parse --show-toplevel)
   for wt_line in $(git worktree list --porcelain | grep "^worktree " | sed 's/^worktree //'); do
     # Skip the main working directory
     [ "$wt_line" = "$MAIN_WD" ] && continue
     # Get the branch name for this worktree
     WT_BRANCH=$(cd "$wt_line" && git branch --show-current 2>/dev/null)
     if [ -n "$WT_BRANCH" ]; then
       echo "Merging worktree branch: $WT_BRANCH"
       # Ensure worktree has all changes committed
       (cd "$wt_line" && git add -A && git diff --cached --quiet || git commit -m "worktree: finalize $WT_BRANCH for merge-back")
       # Merge into project branch
       git merge "$WT_BRANCH" --no-ff -m "merge: worktree $WT_BRANCH into project branch"
     fi
   done
   ```
4. **Clean up ALL worktrees (MANDATORY):** After merging, remove every non-main worktree. This step is non-negotiable — stale worktrees are the #1 cause of "dirty worktree" errors and branch conflicts.
   ```bash
   MAIN_WD=$(git rev-parse --show-toplevel)
   # Remove all non-main worktrees
   git worktree list --porcelain | grep "^worktree " | sed 's/^worktree //' | while read -r wt; do
     [ "$wt" = "$MAIN_WD" ] && continue
     WT_BRANCH=$(cd "$wt" && git branch --show-current 2>/dev/null)
     git worktree remove "$wt" --force 2>/dev/null && echo "Removed worktree: $wt"
     # Delete the temporary worktree branch
     [ -n "$WT_BRANCH" ] && git branch -d "$WT_BRANCH" 2>/dev/null && echo "Deleted branch: $WT_BRANCH"
   done
   # Prune stale references
   git worktree prune
   # Verify — should show only the main working directory
   REMAINING=$(git worktree list | wc -l)
   [ "$REMAINING" -gt 1 ] && echo "WARNING: $((REMAINING - 1)) worktrees still exist after cleanup!"
   ```
5. **Run inter-sprint gate:** `pnpm type-check && pnpm build` (full QA deferred to closing sprint Code Review & QA)
5b. **Compact context:** Run `/compact` with handoff summary: completed sprint tasks, remaining sprints, branch name, any blockers. This prevents context rot during multi-sprint builds.
6. **Verify task completions:** Query Supabase for all tasks in the completed sprint (`metadata.sprint = N`). If any are not `done`, warn and attempt to mark them done with a summary outcome. This prevents tasks from falling through when sub-agents complete code but miss the CLI completion step.
   ```bash
   node packages/db/scripts/task-cli.mjs list --project PROJECT_ID --sprint N 2>/dev/null | python3 -c "
   import sys,json
   tasks=json.load(sys.stdin)
   not_done=[t for t in tasks if t['status'] not in ('done',)]
   for t in not_done:
       print(f'WARNING: Task {t[\"id\"][:8]} \"{t[\"title\"]}\" is {t[\"status\"]}, not done')
   "
   ```
   For any tasks still not `done`, force-complete them:
   ```bash
   for task_id in $NOT_DONE_IDS; do
     node packages/db/scripts/task-cli.mjs complete "$task_id" --agent rick \
       --outcome "Auto-completed during sprint gate — agent may have missed CLI completion step."
   done
   ```
7. **Proceed to next sprint**

### Agent Team Mode

Full team orchestration for large projects.

1. **Create team:**
```
TeamCreate:
  team_name: "build-{project-slug}"
  description: "Building {project name}"
```

2. **Per sprint:**
   a. Create team tasks (TaskCreate) mirroring the Supabase tasks for this sprint
   b. Spawn named agents per task with appropriate model tier:
   ```
   Agent tool call:
     subagent_type: "general-purpose"
     name: "{agent-slug}-{task-short-name}"
     model: "{tier-appropriate model}"
     team_name: "build-{project-slug}"
     isolation: "worktree"  # when 2+ code writers in same sprint
     prompt: |
       You are {AGENT_NAME}, a teammate on the build-{project-slug} team.

       ## Identity & Rules
       [Same as sub-agent prompt above, plus:]
       - You are part of a team. Communicate via SendMessage when done or blocked.
       - Read the team config to discover teammates if needed.

       ## Process
       1. Claim Supabase task: `node packages/db/scripts/task-cli.mjs claim {task_id} --agent {agent_id}`
       2. Read the task description. Write a brief RFC as a task comment.
       3. Implement. Commit after each logical unit.
       4. Verify: `pnpm type-check && pnpm build && pnpm test`
       5. Complete with outcome: `node packages/db/scripts/task-cli.mjs complete {task_id} --agent {agent_id} --outcome "Concise summary of what was built, files changed, and verification results."`
       7. Mark team task completed via TaskUpdate.
       8. Send summary to team lead (rick) via SendMessage.

       ## Your Task
       - Supabase Task ID: {task_id}
       - Team Task ID: {team_task_id}
       - Title: {task_title}
       - Description: {task_description}
       - Sprint: {sprint_number}
   ```
   c. Monitor completions via teammate messages (automatic delivery)
   d. Shutdown completed agents between sprints:
   ```
   SendMessage:
     type: "shutdown_request"
     recipient: "{agent-name}"
     content: "Sprint {N} complete, shutting down for next sprint."
   ```

3. **Between sprints:**
   - **Merge ALL worktree branches into the project branch** (same process as Sub-agent Mode step 3 above)
   - **Clean up ALL worktrees (MANDATORY):** Same cleanup as Sub-agent Mode step 4 — remove every non-main worktree, delete temporary branches, prune stale references. Verify only 1 worktree remains.
   - Resolve any conflicts before spawning next sprint's agents
   - Lightweight gate: `pnpm type-check && pnpm build` (full QA deferred to closing sprint Code Review & QA)
   - **Verify task completions:** Query Supabase for all tasks in the completed sprint. If any are not `done`, force-complete them with a summary outcome:
     ```bash
     node packages/db/scripts/task-cli.mjs list --project PROJECT_ID --sprint N 2>/dev/null | python3 -c "
     import sys,json
     tasks=json.load(sys.stdin)
     not_done=[t for t in tasks if t['status'] not in ('done',)]
     for t in not_done:
         print(f'WARNING: Task {t[\"id\"][:8]} \"{t[\"title\"]}\" is {t[\"status\"]}, not done')
     "
     # Force-complete any stragglers
     for task_id in $NOT_DONE_IDS; do
       node packages/db/scripts/task-cli.mjs complete "$task_id" --agent rick \
         --outcome "Auto-completed during sprint gate — agent may have missed CLI completion step."
     done
     ```

4. **Sprint 99 (closing) — always sequential, MUST produce documents:**

   Sprint 99 closing sequence varies by project type:
   - **Feature/System/Plan**: Code Review -> Design Feedback -> Retro (full sequence)
   - **Research**: Retro -> Research Deliverable

   For **Research** projects, skip Code Review and Design Feedback entirely. Run Retro first, then spawn the Research Deliverable task (SAGE synthesizes all research outcomes + retro into the final deliverable document, saved to vault at `04-projects/{slug}.md`).

   For **Feature/System/Plan** projects, run the full sequence below:

   - **Code Review & QA** (SCAN) runs first:
     1. Claim the task
     2. **Push branch and create PR** (if not already done):
        ```bash
        git push -u origin "$BRANCH"

        # Determine PR base: group branch if project is in a group, otherwise main
        PR_BASE="main"
        if [ -n "$GROUP_BRANCH" ]; then
          PR_BASE="$GROUP_BRANCH"
        fi

        gh pr create --base "$PR_BASE" --title "Feat: <Project Name>" --body "$(cat <<'PREOF'
        ## Why
        <1-2 sentences on the problem/opportunity>

        ## What This Delivers
        <1-2 sentences on the solution and its value>

        ## Feature Set
        - <bullet list of features/changes>

        ## Test Plan
        - [ ] <verification checklist>

        ⭐ Produced by [Celune.ai](https://celune.ai)
        PREOF
        )"
        ```
        Store the PR URL, number, and base branch in project metadata.
     2b. **Add reviewer based on target branch and auto-approve mode:**
        - **PRs targeting `main`** (ALWAYS): `gh pr edit <PR#> --add-reviewer <maintainer>` — The maintainer reviews, required before merge. NEVER auto-merge to main regardless of auto-approve mode.
        - **PRs targeting non-main branches + auto-approve mode**: `gh pr edit <PR#> --add-reviewer rickstrips` — RICK self-reviews (see Phase 4 self-review checklist), then approves and merges
        - **PRs targeting non-main branches + normal mode**: `gh pr edit <PR#> --add-reviewer <maintainer>` — The maintainer reviews
     3. Run full automated QA suite: `pnpm type-check && pnpm build && pnpm test && npx prettier --check .`
     4. If prettier fails, run `npx prettier --write .` and commit the fix
     5. Perform manual code review: security patterns, quality, architecture, regression risk
     6. **Submit review on GitHub PR** via `POST /api/github/reviews`:
        ```json
        {
          "workspace_id": "<ws-id>",
          "pr_number": <pr-number>,
          "event": "REQUEST_CHANGES" | "APPROVE",
          "body": "<structured review summary>",
          "comments": [
            { "path": "src/file.ts", "line": 42, "body": "Finding: ..." }
          ]
        }
        ```
        Use `APPROVE` if no issues found, `REQUEST_CHANGES` if issues exist.
     7. Write the structured Code Review & QA document (includes both automated results and manual findings)
     8. **Post the document as a comment** on the Code Review task: `node packages/db/scripts/task-cli.mjs comment <task-id> --author scan --content "..."`
     9. Also write the document to the task `outcome` field
     10. **Auto-create and execute fix tasks:** For each issue found during code review, automatically create a Supabase task linked to this project with `--spawned-by <code-review-task-id>`. Then execute each fix task immediately (claim → implement → verify → complete). This ensures all CR findings are resolved before moving to the retro — no manual triage needed.
        ```bash
        # For each issue found:
        node packages/db/scripts/task-cli.mjs create \
          --title "Fix: <issue summary>" \
          --description "## What\n<issue details from CR>\n\n## Approach\n<fix steps>" \
          --project PROJECT_ID \
          --priority high \
          --assignee rick \
          --status inbox \
          --spawned-by <code-review-task-id>
        # Then claim, implement, verify, complete each fix task
        ```
     11. After all fixes, **reply to each GitHub PR comment** via `POST /api/github/reviews/reply` to mark findings as resolved
     12. Re-run verification after all fixes: `pnpm type-check && pnpm build && pnpm test`
     13. If all fixes pass, **submit approval review** on the PR via `/api/github/reviews` with `event: "APPROVE"`
     14. **Log to memory**: Append findings to `memory/code-review-log.md` — project name, date, one-liner per finding, fix status
     15. Complete the Code Review task only after all fix tasks are done

   - **Design Feedback** (NOIR) runs only after CR completes:

     **Skip check:** If the Design Feedback task is already `done` (auto-skipped because no UI changes were detected), skip entirely and proceed to Retro.

     1. Claim the task
     2. Review all impl task outcomes and code changes — focus on user-facing files
     3. Check experience against PRD:
        - **Visual Review**: design tokens, spacing, typography, dark mode, responsive
        - **UX Review**: flow, loading/error/empty states, keyboard nav, ARIA
        - **PRD Compliance**: every UI requirement has implementation
     4. Write structured Design Feedback document
     5. Post as comment: `node packages/db/scripts/task-cli.mjs comment <task-id> --author noir --content "..."`
     6. Write to outcome field
     7. Present suggestions to the user via `AskUserQuestion`:
        ```
        Question: "NOIR found {N} design suggestions. How should we proceed?"
        Options:
          1. "Auto-implement all" — "Create fix tasks and execute them now"
          2. "Let me review" — "Show the list so I can approve/reject each"
          3. "Skip design fixes" — "Proceed to retro without fixes"
        ```
        Based on the answer:
        - **Auto-implement all**: Create a Supabase task for each fix with `--spawned-by <design-feedback-task-id>`, then implement each (claim → implement → verify → complete).
        - **Let me review**: Present each suggestion individually. For approved ones, create + execute fix tasks. For rejected ones, note in outcome.
        - **Skip design fixes**: Proceed to retro.
     8. Re-verify visual correctness after fixes
     9. **Log to memory**: Append findings to `memory/design-feedback-log.md` — date, project name, findings summary, fixes applied, verdict (Approved / Approved with fixes / Skipped)
     10. **Design Review Approval Gate:**
        - Check `~/.claude/state/auto_approve` flag (set by `/auto-approve` skill)
        - **Auto-approve mode ON**: Mark design as approved and proceed directly to Retro. Record in task outcome: `"Design approved (auto-approve mode)"`.
        - **Auto-approve mode OFF**: Present via `AskUserQuestion`:
          ```
          Question: "NOIR completed the Design Feedback review ({N} suggestions found, {M} applied).
          Do you approve the design review?"
          Options:
            1. "Yes, approved" — "Proceed to the project retrospective"
            2. "No — needs changes" — (free text) what specifically needs fixing
            3. "Skip design review" — "Move to retro without design approval"
          ```
          - **Yes**: Record `"Design approved by the user"` in task outcome. Proceed to Retro.
          - **No / feedback given**: Create fix tasks from the feedback (`--spawned-by <design-feedback-task-id>`), execute them (claim → implement → verify → complete), then re-present the approval gate.
          - **Skip**: Record `"Design review skipped by the user"` in task outcome. Proceed to Retro.
     11. Complete the Design Feedback task

   - **Retro** (SAGE) runs only after Design Feedback completes:
     1. Claim the task
     2. Gather context: PRD, code review findings (including fix tasks), design feedback findings (including design fix tasks), all task outcomes
     3. Write the structured Retro document (Pros, Cons, Action Items)
     4. **Create a Supabase task for EACH action item** using `--spawned-by <retro-task-id>`. Assign each to the appropriate agent per the pod delegation table. Place them in the **inbox** so they're visible on the kanban.
     5. **Append an "Additional Steps" section** to the Retro document listing every task created in step 4, with task ID (short UUID), title, and assignee. This section is REQUIRED — it provides visibility into what follow-up work was spawned.
     6. **Post the FULL document (including Additional Steps) as a comment** on the Retro task: `node packages/db/scripts/task-cli.mjs comment <task-id> --author sage --content "..."`
     7. Also write the full document to the task `outcome` field
     8. **Log to memory**: Append spawned improvement tasks to `memory/retro-improvements.md` — date, project, task title, one-liner description, status
     9. Complete the task
     10. **Auto-execute all retro improvement tasks.** After the retro is complete, immediately execute every improvement task created in step 4:
        - If 1-2 tasks: execute inline (claim → implement → verify → complete) sequentially
        - If 3+ tasks: spawn sub-agents with `run_in_background: true` for parallelism
        - This is the default behavior. In the future, this will be configurable per-org/workspace (auto-execute, move to EOW cleanup, or manual triage). Until that setting exists, always auto-execute.

   - **CRITICAL: All closing task documents MUST be posted as comments.** The outcome field alone is not sufficient — comments are the visible paper trail in the TaskDrawer activity feed. Without comments, the closing tasks are incomplete.

5. **Clean up:** `TeamDelete` after all sprints complete

---

## Phase 4: Wrap-up

### 1. Final Verification

```bash
pnpm type-check && pnpm build && pnpm test && npx prettier --check .
```

If prettier fails, run `npx prettier --write .` and commit the formatting fix.

### 1b. Push Final Commits & Update PR

If a Git branch was created (Phase 2f), push all remaining commits:
```bash
git push origin "$BRANCH"
```

If the PR exists, update its description with the final feature set and verification results using `gh pr edit`.

**PR merge — depends on target branch:**

- **PRs targeting `main` (ALWAYS — regardless of auto-approve mode):** Review is assigned to `<maintainer>`. Wait for the maintainer's approval. Do NOT merge until approved. Main is the production branch — human sign-off is non-negotiable.
- **PRs targeting non-main branches + auto-approve mode:** Review is assigned to `rickstrips` (RICK). Run the **self-review checklist**:
  1. Every task listed in the PR description exists in Supabase with the correct `project_id`
  2. Code Review, Design Feedback, and Retrospective sections are filled (or marked Skipped with reason)
  3. Verification section shows all checks passing
  4. Improvement tasks from retro are created and linked to a project
  5. No uncommitted changes on the branch
  6. `pnpm type-check && pnpm build && pnpm test` all pass
  - **If all checks pass:** Approve the PR via `gh pr review <PR#> --approve --body "Self-review passed. All tasks verified."`, then merge via `gh pr merge <PR#> --squash`
  - **If checks fail:** Fix the issues, push fixes, then approve and merge
- **PRs targeting non-main branches + normal mode:** Review is assigned to `<maintainer>`. Wait for approval.

### 1c. Group PR Check (if project belongs to a group)

After the project PR merges into the group branch, check whether all projects in the group now have merged PRs.

```python
if group_id and GROUP:
    # Fetch all projects in the group
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/projects?group_id=eq.{group_id}&select=id,name,metadata",
        headers={**headers, "Prefer": ""},
    )
    resp = urllib.request.urlopen(req, timeout=10)
    group_projects = json.loads(resp.read().decode())
    group_project_ids = [p["id"] for p in group_projects]

    # Fetch all project_prs records for this group
    ids_csv = ",".join(group_project_ids)
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/project_prs?project_id=in.({ids_csv})&select=*",
        headers={**headers, "Prefer": ""},
    )
    resp = urllib.request.urlopen(req, timeout=10)
    all_prs = json.loads(resp.read().decode())

    merged_prs = [pr for pr in all_prs if pr.get("status") == "merged"]
    all_merged = len(merged_prs) == len(group_projects)
```

**If all projects in the group have merged PRs:**

1. Build the group PR body — aggregate each project's PR title and one-liner summary:

   ```
   ## Epic: {Group Name}

   This PR consolidates all projects from the **{Group Name}** epic into `main`.

   ## Projects Included

   | Project | PR | Summary |
   |---------|-----|---------|
   | {project_name} | #{pr_number} | {pr_title_or_one_liner} |
   | ...     | ... | ...     |

   ## Combined Feature Set

   {aggregated bullet points from each project PR body's "What This Delivers" section}

   ## Test Plan

   - [ ] All individual project PRs reviewed and merged to group branch
   - [ ] `pnpm type-check` passes on group branch
   - [ ] `pnpm build` passes on group branch
   - [ ] `pnpm test` passes on group branch
   - [ ] Manual regression QA on `{GROUP_BRANCH}`

   ⭐ Produced by [Celune.ai](https://celune.ai)
   ```

2. Create the group PR targeting `main`:

   ```bash
   gh pr create \
     --title "Epic: {Group Name}" \
     --base main \
     --head "$GROUP_BRANCH" \
     --body "$(cat <<'EPIC_EOF'
   <body from step 1>
   EPIC_EOF
   )"
   ```

3. **Always assign `<maintainer>` as reviewer** — regardless of auto-approve mode. Group PRs target `main` and are the production gate for the entire epic. The user must approve. No exceptions.

   ```bash
   gh pr edit <GROUP_PR_NUMBER> --add-reviewer <maintainer>
   ```

4. Store the group PR in group metadata:

   ```python
   GROUP_META = GROUP.get("metadata") or {}
   req = urllib.request.Request(
       f"{SUPABASE_URL}/rest/v1/project_groups?id=eq.{group_id}",
       data=json.dumps({"metadata": {
           **GROUP_META,
           "group_pr_number": group_pr_number,
           "group_pr_url": group_pr_url,
           "group_pr_status": "open",
       }}).encode(),
       headers={**headers, "Prefer": "return=minimal"},
       method="PATCH"
   )
   urllib.request.urlopen(req, timeout=10)
   ```

5. Report:

   ```
   ## Group PR Created: Epic — {Group Name}

   All {N} projects in this group have merged into `{GROUP_BRANCH}`.
   Group PR #{group_pr_number}: {group_pr_url}

   - Base: main
   - Head: {GROUP_BRANCH}
   - Reviewer: @<maintainer> (required — targets main)
   - Projects: {list of project names}

   Waiting for the maintainer's approval before merge.
   ```

**If not all projects have merged yet:**

```
## Group PR Pending — {Group Name}

{merged}/{total} projects have merged PRs into `{GROUP_BRANCH}`.
Still waiting on:
- {pending_project_name} — PR #{pr_number} ({pr_status})
- ...

Group PR will be auto-created when all {total} projects are merged.
```

---

### 1d. Group PR Merge Handler

When the group PR is merged (the user merges `{GROUP_BRANCH}` → `main`), run this handler. RICK detects merge status by checking `gh pr view <group_pr_number> --json state` when `/build` is invoked for any project in the group, or when the user explicitly calls `/build group-merged <group_id>`.

1. **Confirm merge:**

   ```bash
   gh pr view {group_pr_number} --json state,mergedAt | jq '{state,mergedAt}'
   # state must be "MERGED"
   ```

2. **Update group metadata:**

   ```python
   import datetime
   merged_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
   req = urllib.request.Request(
       f"{SUPABASE_URL}/rest/v1/project_groups?id=eq.{group_id}",
       data=json.dumps({"metadata": {
           **GROUP_META,
           "group_pr_status": "merged",
           "merged_at": merged_at,
       }}).encode(),
       headers={**headers, "Prefer": "return=minimal"},
       method="PATCH"
   )
   urllib.request.urlopen(req, timeout=10)
   ```

3. **Clean up group branch** (after confirming merge to prevent data loss):

   ```bash
   git push origin --delete "$GROUP_BRANCH"
   git branch -d "$GROUP_BRANCH" 2>/dev/null || true
   ```

4. **Notify the user:**

   ```
   ## Epic Merged: {Group Name}

   Group PR #{group_pr_number} merged to `main`. Epic complete.
   - Group branch `{GROUP_BRANCH}` deleted
   - Group metadata updated: status = merged, merged_at = {timestamp}
   - Will be live on next Vercel deploy
   ```

### 2. Verify All Tasks Done

Query Supabase for any non-done tasks in the project:
```python
req = urllib.request.Request(
    f"{SUPABASE_URL}/rest/v1/tasks?project_id=eq.{PROJECT_ID}&status=neq.done&select=id,title,status",
    headers={**headers, "Prefer": ""},
)
resp = urllib.request.urlopen(req, timeout=10)
remaining = json.loads(resp.read().decode())
```

If tasks remain, list them with status and reason (blocked, failed, skipped).

### 3. Copy SQL Migrations

If any `.sql` migration files were created during the build:
```bash
cp packages/db/schema/migrations/*.sql ~/Documents/sqleditor/ 2>/dev/null
```

Only copy new migrations — check timestamps against what's already in the sqleditor folder.

### 4. Clean Up

- **Agent Team mode:** `TeamDelete`
- **Worktrees:** Auto-cleaned by the Agent tool if no changes; merge and delete branches for completed worktrees
- **Sentinel files:** Remove `~/.claude/state/afk_active` if it was set

### 5. Final Summary

```
## Build Complete: {project name}

### Sprint Results
| Sprint | Tasks | Status | Duration |
|--------|-------|--------|----------|
| 1 | 3 | All done | ~15 min |
| 2 | 2 | All done | ~10 min |
| 99 | 3 | All done | ~10 min |

### Verification
| Check | Result |
|-------|--------|
| Type check | PASS |
| Build | PASS |
| Tests | PASS (32/32) |
| Prettier | PASS |

### Code Review Highlights
- [Key findings from SCAN's code review]

### Design Feedback Highlights
- [Key findings from NOIR's design review, or "Skipped — no UI changes"]

### Retro Action Items
- [Action items from SAGE's retrospective]

### Skipped / Blocked
- [Any tasks that couldn't be completed and why]

### Stats
| Metric | Value |
|--------|-------|
| Total tasks | {N} |
| Completed | {N} |
| Blocked/Skipped | {N} |
| Orchestration mode | {Solo/Sub-agents/Agent Team} |
| Agents spawned | {N} |
| SQL migrations | {N} (copied to ~/Documents/sqleditor/) |
```

---

## Edge Cases

### No Tasks Yet
If the project has zero tasks:
> This project has no tasks. Use `/project-plan` to populate it first, then `/build` to execute.

### All Tasks Already Done
Skip to Phase 4. Run verification only and present the summary.

### Blocked Task Cascades
When a task is blocked:
1. Skip the blocked task
2. Identify all tasks that depend on it (transitive closure of `depends_on`)
3. Skip the entire cascade
4. Warn about the cascade in the Build Readiness Report and Final Summary

### Agent Failure Mid-Sprint
If a spawned agent fails or times out:
1. Mark the Supabase task as blocked: `node packages/db/scripts/task-cli.mjs block <id> --reason "Agent failure: ..." --agent rick`
2. Continue with independent tasks in the same sprint
3. Report failures in the Final Summary
4. Do NOT retry automatically — surface for the user to decide

### Context Hygiene (ALL projects)
Compact proactively to prevent quality degradation:
1. **Between every sprint:** Run `/compact` with a handoff summary listing: completed tasks, remaining tasks, current branch, key decisions. Do NOT wait until context feels full — compact preemptively.
2. **After closing gate tasks (CR, DF):** Compact before Retro to give SAGE maximum headroom.
3. **After Phase 1 validation:** If many auto-fixes were applied, compact before execution begins.
4. Each sprint starts with a fresh context read of remaining tasks from Supabase.

### Context Exhaustion (Large Projects)
For projects with 10+ tasks or 4+ sprints:
1. Write a context handoff summary between sprints
2. Use sub-agents as context firewalls — each agent gets fresh context
3. If context exceeds 70% capacity, compact immediately (don't wait for 95% auto-compact)

### Single-Task Mode
When building a single task (no project):
1. Skip Phase 1 (no project-level validation needed)
2. Phase 2 auto-selects Solo mode (override still available)
3. Phase 3 follows Solo mode lifecycle
4. Phase 4 runs verification and produces a completion report

**Deep Build option:** For effort=L tasks or when the user requests iterative verification, delegate to `/deep-build` instead. This runs a verification loop after every iteration rather than a single pass. Use when quality matters more than speed.

---

## Best Practices (from /afk-building)

These apply to every build regardless of mode:

- **Auth:** Never expose service keys client-side. Use `createServiceClient()` server-side only.
- **Validation:** Validate all inputs at API boundaries. Use Zod or manual type guards.
- **RLS:** Every new table needs Row Level Security policies. Test them.
- **Error handling:** Never leak internal errors to the client. Log server-side, return safe messages.
- **Migrations:** Auto-copy SQL to `~/Documents/sqleditor/`. Include rollback.
- **Types:** Keep `@repo/types` as single source of truth. No inline type definitions.
- **Design tokens:** Use theme.css tokens. No hardcoded colors.
- **Commits:** Clear messages, atomic changes, signed with Co-Authored-By.
- **No over-engineering:** Build what's needed now, not what might be needed later.
- **Task hygiene:** Claim at start, complete on delivery. The kanban must always reflect real-time state.

---

## Relationship to Other Skills

| Skill | Relationship |
|-------|-------------|
| `/project-plan` | Creates projects + tasks. `/build` executes them. Use `/project-plan` first if no tasks exist. |
| `/afk-building` | Single-task execution loop. `/build` subsumes this — use `/build` for both single tasks and full projects. |
| `/task` | Creates individual tasks. `/build` can execute a single task created by `/task`. |
| `/todays-project` | Daily planning. Can feed task IDs into `/build` for execution. |
| `/security-audit` | Creates security tasks. `/build` can execute the resulting project. |
