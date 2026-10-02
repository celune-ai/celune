---
name: task
description: 'Create individual Supabase inbox tasks with structured descriptions (What/Value/Approach/Sequence/Blockers).'
user_invocable: true
---

# /task — Create Structured Inbox Tasks

Create one or more actionable Supabase tasks from research, analysis, or a specific need.

## Arguments

`/task <topic, URL, or description>`

- A YouTube URL → fetch transcript, extract actionable items, create tasks
- A topic (e.g., "security hardening") → research current state, identify gaps, create tasks
- A codebase area (e.g., "admin app auth") → audit implementation, create improvement tasks
- A URL → fetch content, extract actionable items, create tasks
- A direct description (e.g., "add dark mode toggle to nav") → create the task directly

## Workflow

### Step 1: Gather Input

Determine input type and gather raw content:

**YouTube URL:**

```bash
KEY=$(grep TRANSCRIPT_API_KEY $VAULT_ROOT/.env | cut -d"'" -f2)
curl -s -H "Authorization: Bearer $KEY" \
  "https://transcriptapi.com/api/v2/youtube/transcript?video_url=VIDEO_URL&format=text&send_metadata=true"
```

**Web URL:** Use WebFetch to extract content.

**Topic/Codebase Area:** Launch an Explore agent to research the current state:

```
Use Task tool with subagent_type=Explore to investigate:
- Current files, configs, implementations
- What exists vs what's missing
- Patterns and conventions in use
```

**Direct description:** Skip research, go straight to task creation.

### Step 2: Extract Actionable Items

From the gathered content, identify:

- Gaps between current state and ideal
- Specific improvements or fixes needed
- New features or capabilities to add

If the source content is reference-worthy, save to vault:

```
$VAULT_ROOT/05-knowledge/<topic-slug>.md
```

### Step 3: Create Tasks

For each actionable item, create a Supabase task.

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
```

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
- `project_id`: Only set if the user specifies a project or one is contextually obvious
- `category`: Array of tags from [engineering, security, dx, testing, performance, seo, marketing, analytics, agent-system, design, monitoring, cost-optimization, career, brand, relationships, growth]

**Assignee Selection:**

Assign tasks to the agent whose domain matches:

| Domain                                                    | Assignee                             |
| --------------------------------------------------------- | ------------------------------------ |
| Product strategy, roadmap, task descriptions, retros      | `sage` (SAGE — PM + Writer)          |
| UX/UI, design system, prototyping                         | `noir` (NOIR — Designer)             |
| Code review, QA, testing                                  | `scan` (SCAN — Code Reviewer)        |
| Web research, competitive analysis                        | `delv` (DELV — Researcher)           |
| Career strategy, networking, skills                       | `trek` (TREK — Career)               |
| Personal brand, social media                              | `echo` (ECHO — Brand)                |
| CRM, follow-ups, relationships                            | `bond` (BOND — Relationships)        |
| Goals, habits, wellness                                   | `vita` (VITA — Growth)               |
| Architecture, code, engineering, security, infra, content | `rick` (RICK — Lead, codes directly) |

Default to `rick` for engineering, security, infra, content, and any cross-domain work. RICK codes directly — delegation is only for parallelism or specialized domains.

**Create via task-cli.mjs:**

```bash
node $CELUNE_REPO/packages/db/scripts/task-cli.mjs \
  create "Task title" --priority normal --assignee rick
```

For bulk creation with full descriptions, use multiple CLI calls or pass `--description` inline:

```bash
node $CELUNE_REPO/packages/db/scripts/task-cli.mjs \
  create "Task title" \
  --priority normal \
  --assignee rick \
  --category engineering \
  --description "## What
[scope]

## Value
[why it matters]

## Approach
1. Step one
2. Step two

## Sequence
No dependencies — can start immediately.

## Blockers
None — ready to go."
```

### Step 4: Summary

Present the user with:

1. Knowledge saved (if any) — vault path
2. Tasks created — table with: title, priority, status (READY / BLOCKED BY USER)
3. Blockers requiring the user's input — list of specific decisions needed

## Conventions

- **Ready tasks** (assignee=rick): RICK can complete autonomously.
- **Blocked tasks** (assignee=unassigned): the user must make a decision or provide something. Say exactly what.
- **Priority mapping:**
  - urgent: Security vulnerability or production issue
  - high: Significant gap affecting quality or reliability
  - normal: Good improvement, no urgency
  - low: Nice-to-have, stretch goal
- Always use the `## What / ## Value / ## Approach / ## Sequence / ## Blockers` description format (adapt sections to task type)
- Always add category tags for filtering
- Do NOT create projects — use `/project-plan` for that
- If the user wants tasks grouped under a project, suggest `/project-plan` instead
