# Project Research — Code & Templates

## Create Project (Supabase)

**Read `~/.claude/skills/_shared/supabase-connect.md` for connection boilerplate (env parsing, headers, workspace resolution).**

```python
project = {
    "name": "<Concise research project name>",
    "description": "<Embeds Q&A answers: topic, why, output type, depth, key questions>",
    "status": "active",
    "project_type": "research",
    "category": "<appropriate category>",
    "workspace_id": WORKSPACE_ID,
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

No `prd_content` — research projects skip PRDs entirely.

## Create Closing Tasks

### Task 1: Project retrospective (SAGE, Sprint 99)

```python
# Collect all research task IDs
research_task_ids = [t["id"] for t in created_task_rows]

retro_task = {
    "title": "Project retrospective",
    "description": """## What
Multi-agent retrospective reviewing research execution and findings quality.

## Approach
1. Gather context: all research task outcomes and comments.
2. Run the retro — each contributing agent shares perspective.
3. Produce structured retro doc (Pros, Cons, Action Items) in task outcome.
4. Create follow-up tasks for action items with --spawned-by.
5. Post retro as comment on this task.
6. Pass retro content forward to the Research Deliverable task.

## Sequence
- Blocked by: ALL research tasks
- Unblocks: Research Deliverable task

## Blockers
None — agents can complete autonomously once all research is done.""",
    "priority": "normal",
    "status": "inbox",
    "assignee": "sage",
    "project_id": PROJECT_ID,
    "category": ["agent-system"],
    "metadata": {"sprint": max_research_sprint + 1},
    "depends_on": research_task_ids,
}

req = urllib.request.Request(
    f"{SUPABASE_URL}/rest/v1/tasks",
    data=json.dumps(retro_task).encode(),
    headers=headers,
    method="POST"
)
resp = urllib.request.urlopen(req, timeout=10)
result = json.loads(resp.read().decode())
retro_row = result[0] if isinstance(result, list) else result
RETRO_TASK_ID = retro_row["id"]
```

### Task 2: Research deliverable (SAGE, Sprint 99)

```python
deliverable_task = {
    "title": "Research deliverable: <output_type from Q&A>",
    "description": """## What
Synthesize ALL research task outcomes + retro findings into the final deliverable document.

## Approach
1. Read all research task outcomes from this project.
2. Read the retro outcome (includes Pros/Cons/Action Items).
3. Synthesize into the requested output format: <output_type>.
4. Save to vault: $VAULT_ROOT/04-projects/<slug>.md
5. Write deliverable summary to this task's outcome field.
6. Post as comment on this task.

## Sequence
- Blocked by: Project Retrospective
- This is the LAST task — project completes after this.

## Blockers
None — SAGE can complete autonomously once retro is done.""",
    "priority": "high",
    "status": "inbox",
    "assignee": "sage",
    "project_id": PROJECT_ID,
    "category": ["engineering"],
    "metadata": {"sprint": max_research_sprint + 1},
    "depends_on": [RETRO_TASK_ID],
}

req = urllib.request.Request(
    f"{SUPABASE_URL}/rest/v1/tasks",
    data=json.dumps(deliverable_task).encode(),
    headers=headers,
    method="POST"
)
resp = urllib.request.urlopen(req, timeout=10)
result = json.loads(resp.read().decode())
deliverable_row = result[0] if isinstance(result, list) else result
```

Dependency chain: All research tasks -> Retro -> Research Deliverable
