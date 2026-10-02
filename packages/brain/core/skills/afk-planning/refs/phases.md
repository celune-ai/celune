# AFK Planning — Detailed Phase Instructions

## Phase 1: External Research (discovery)

Scan external sources for feature ideas, competitive intel, and user pain points relevant to our platform (admin dashboard, task system, agent orchestration, design system, docs site).

**Sources to scan (use available tools):**

| Source              | How                                               | What to look for                                                                                                |
| ------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| YouTube             | `/youtube-transcript` skill for relevant channels | Tutorials on tools like Linear, Notion, Vercel; agent/AI workflow patterns; product design insights             |
| Reddit              | MCP tool (see note below)                         | r/selfhosted, r/webdev, r/nextjs, r/SaaS, r/ProductManagement — pain points, feature requests, "I wish X did Y" |
| X / Twitter         | Web search                                        | Discourse around AI agents, task management, developer tools, indie SaaS                                        |
| Newsletters / Blogs | Web search                                        | Product launches, design system trends, developer experience patterns                                           |
| Slack               | `slack_search_public_and_private`                 | The user's recent conversations for context on priorities and interests                                         |

**Reddit MCP note:** We don't have a Reddit MCP yet. On first run, create an inbox task:

```
Title: Set up Reddit MCP server for autonomous research
Description: Install and configure a Reddit MCP server so planning mode can search subreddits, read threads, and track discussions. Needed for /afk-planning external research phase.
Tags: infra, agent-system
Priority: high
```

**Output:** For each interesting finding, decide:

- **New task?** Create it in Supabase inbox with full 5-section description (What/Value/Approach/Sequence/Blockers)
- **Enhances existing task?** Update that task's description with the new context
- **Not actionable?** Skip it

## Phase 2: Task Audit (backlog grooming)

Pull all open tasks from Supabase and audit them:

```python
python3 scripts/task_client.py list --all-open
```

**For each task, check:**

1. **Description quality** — Does it have all 5 sections (What/Value/Approach/Sequence/Blockers)? If not, flesh it out. Agents pick up tasks cold; rich descriptions = better execution.
2. **Stale tasks** — Anything untouched for 2+ weeks with no blockers? Either reprioritize, add a blocker reason, or recommend archiving.
3. **Duplicate detection** — Are any tasks essentially the same work? Merge them (keep the better-described one, close the other).
4. **Missing tags** — Run auto-tagger logic. Every task should have at least one category tag.
5. **Blocked tasks** — Check if blockers are still valid. If the blocker is resolved, clear it and move to planning.

## Phase 3: Project Grouping (pattern recognition)

Look for clusters of related tasks that should be grouped into projects:

- 3+ tasks touching the same feature area = candidate for a project
- Tasks with sequential dependencies = should be in the same project with ordering
- Recurring themes across inbox items = potential new project

**Actions:**

- Create Supabase projects for identified clusters (if they don't exist)
- Link tasks to their projects via `project_id`
- Set task ordering within projects based on dependency analysis

## Phase 4: Priority Calibration

Re-evaluate priorities across the entire backlog:

**Priority framework:**

| Priority   | Criteria                                                   |
| ---------- | ---------------------------------------------------------- |
| **Urgent** | Blocking other work, security issue, broken functionality  |
| **High**   | Revenue impact, user-facing improvement, unblocks 2+ tasks |
| **Normal** | Quality improvement, nice-to-have feature, tech debt       |
| **Low**    | Cosmetic, speculative, "someday"                           |

**Consider:**

- What moves the needle on the $1k break-even goal?
- What improves agent autonomy and execution quality? (agents are primary task consumers)
- What has the best effort-to-impact ratio?
- Are there quick wins sitting at normal priority that should be high?
- Are there high-priority tasks that are actually blocked and should be flagged?

Update priorities in Supabase where they've drifted.

## Phase 5: Planning Queue

Ensure the `planning` status column has a healthy queue of ready-to-execute tasks:

- **Target:** 5-10 tasks in `planning` status, assigned to `rick`
- **Mix:** Balance quick wins (S/M effort) with deeper work (L effort)
- **If queue is thin:** Promote well-described `inbox` or `assigned` tasks
- **If queue is bloated:** Deprioritize or move lower-priority items back to backlog

## Phase 6: Log and Loop

Write a brief summary of what changed this cycle to the vault:

```
memory/sessions/YYYY-MM-DD.md (append)
```

Include:

- Tasks created, updated, merged, or archived
- Projects created or modified
- Priority changes
- Key insights from research

Then cooldown 5 minutes and start the next cycle.
