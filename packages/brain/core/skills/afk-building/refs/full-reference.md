# /afk-building — Full Reference

Complete original SKILL.md preserved for reference. Core SKILL.md has lean lifecycle steps.

---

## RFC Template

```markdown
## RFC: {task title}

### Problem Statement

What user/agent pain point does this solve? Why now?

### Proposed Solution

High-level architecture. What changes, what stays the same.

### Technical Design

- **Files to create/modify** (list with brief rationale)
- **Database changes** (migrations, new tables/columns, RLS policies)
- **API surface** (new routes, changed contracts)
- **UI changes** (components, pages, state management)
- **Dependencies** (new packages, external services)

### Security Considerations

Auth, input validation, RLS, service key isolation, XSS/injection vectors.

### Testing Strategy

What to test, how to verify, acceptance criteria.

### Rollback Plan

How to undo if something goes wrong.

### Effort Estimate

S (<15 min) | M (15-60 min) | L (1-3 hours) | XL (3+ hours)
```

---

## Orchestration Tiers

**Tier 1 (Single Agent):** S/M effort, single domain, <3 files — execute directly.

**Tier 2 (Sub-Agents):** M/L effort, 2-4 independent work streams:

| Role         | Agent Type                     | Responsibility                              |
| ------------ | ------------------------------ | ------------------------------------------- |
| **Planner**  | `Plan`                         | Architecture decisions, file identification |
| **Builder**  | `general-purpose`              | Write code, create files, run builds        |
| **Reviewer** | `general-purpose` (read-heavy) | Code review, security audit                 |
| **Tester**   | `general-purpose`              | Type-check, build, test suites              |

- Use `spawn_child_task()` for trackable sub-work
- Run independent sub-agents in parallel via `run_in_background: true`

**Tier 3 (Agent Teams):** XL effort, 4+ interdependent streams:

- Requires the maintainer's approval
- Use `TeamCreate` for full agent team coordination

**Staffing rules:**

- API routes or auth changes MUST have a reviewer
- Every build MUST run `pnpm type-check` and `pnpm build`
- Database migrations get auto-copied to `~/Documents/SQL Editor/`
- Branch: `afk/{task_id}`
- Commit early and often

---

## Completion Report Template

```markdown
## Build Report: {task title}

### Summary

One paragraph on what was built and why.

### Scope

| Area             | Details               |
| ---------------- | --------------------- |
| Files created    | {list}                |
| Files modified   | {list}                |
| Lines changed    | +{added} / -{removed} |
| Database changes | {migrations, if any}  |
| New dependencies | {packages, if any}    |

### PRD Requirements

| Requirement | Status | Notes               |
| ----------- | ------ | ------------------- |
| {req 1}     | Done   | {how it was solved} |

### RFC Adherence

| RFC Section      | Followed?   | Deviations             |
| ---------------- | ----------- | ---------------------- |
| Technical Design | Yes/Partial | {what changed and why} |

### Testing

| Test                | Result   | Command            |
| ------------------- | -------- | ------------------ |
| Type check          | Pass     | `pnpm type-check`  |
| Build               | Pass     | `pnpm build`       |
| Unit tests          | Pass/N/A | `pnpm test`        |
| Manual verification | Pass     | {what was checked} |

### Git

| Field       | Value             |
| ----------- | ----------------- |
| Branch      | `afk/{task_id}`   |
| Commits     | {count}           |
| Key commits | {hash}: {message} |

### Follow-up Tasks

| Task | Priority | Created? |
| ---- | -------- | -------- |

### Metadata

| Field              | Value            |
| ------------------ | ---------------- |
| Task ID            | {id}             |
| Started            | {timestamp}      |
| Completed          | {timestamp}      |
| Duration           | {minutes}        |
| Effort (estimated) | {S/M/L/XL}       |
| Effort (actual)    | {S/M/L/XL}       |
| Orchestration tier | {1/2/3}          |
| Sub-agents used    | {list or "none"} |
```

Write to: `memory/overnight/afk-{timestamp}-{task_id}.md` + task `outcome` field.

**Email (if AGENTMAIL_API_KEY is set):**

```bash
node -e "
import('@repo/agentmail').then(({ sendAgentReport }) => {
  return sendAgentReport({
    from: 'rick',
    subject: 'Build Report: {task title}',
    markdown: \`{completion report markdown}\`
  });
}).then(r => console.log(r.ok ? 'Emailed: ' + r.messageId : 'Email failed: ' + r.error));
"
```

---

## PRD Approval Gate Code

```python
import json, urllib.request

env_file = "$CELUNE_REPO/apps/admin/.env.local"
SUPABASE_URL = SUPABASE_KEY = ""
with open(env_file) as f:
    for line in f:
        if line.startswith("NEXT_PUBLIC_SUPABASE_URL="): SUPABASE_URL = line.split("=",1)[1].strip()
        elif line.startswith("SUPABASE_SERVICE_ROLE_KEY="): SUPABASE_KEY = line.split("=",1)[1].strip()
headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

def prd_approved(task):
    project_id = task.get("project_id")
    if not project_id:
        return True
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/projects?id=eq.{project_id}&select=name,project_type,prd_metadata",
        headers=headers
    )
    proj = json.loads(urllib.request.urlopen(req, timeout=10).read().decode())
    if not proj: return True
    p = proj[0]
    if p.get("project_type") == "research": return True
    status = (p.get("prd_metadata") or {}).get("status", "draft")
    if status != "approved":
        print(f"Skipped task '{task['title']}' — project '{p['name']}' PRD not approved (status: {status}).")
        return False
    return True

tasks = [t for t in tasks if prd_approved(t)]
```
