# Phase 0 Pre-Build Checks

## Phase 0b: Project Consolidation Check

Before building, check for active projects that overlap with the target.

```python
# Fetch all active projects (excluding the current one)
req = urllib.request.Request(
    f"{SUPABASE_URL}/rest/v1/projects?status=eq.active&id=neq.{PROJECT['id']}&select=id,name,description,project_type,category",
    headers={**headers, "Prefer": ""},
)
resp = urllib.request.urlopen(req, timeout=10)
active_projects = json.loads(resp.read().decode())
```

Check for overlap by: name/description similarity, task overlap, dependency relationship.

**When overlap found, present options:**
1. "Absorb overlapping tasks" — Merge into this project as additional sprints
2. "Sequence projects" — Build this first, note dependency
3. "Proceed as-is" — Independent

If absorbing: move tasks, update sprint numbers, update PRD, consider archiving source project.

## Phase 0c: PRD Approval Gate

**Skip if `project_type == 'research'` or `mode == 'single-task'`.**

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
```

> **Trust boundary:** `/build` auto-approves. AFK modes must skip unapproved projects.
