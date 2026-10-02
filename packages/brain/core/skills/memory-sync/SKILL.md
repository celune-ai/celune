---
name: memory-sync
description: 'Pull recent Celune remote memories into your local vault. Deduplicates, curates, and saves to auto-memory or 05-knowledge. Hookable into /closing-time.'
user_invocable: true
---

# /memory-sync -- Reverse Sync Celune Memory to Local

Pull recent memories from Celune's agent_memory table, deduplicate against local files, and curate into the appropriate local layer.

## Arguments

`/memory-sync [--since YYYY-MM-DD] [--dry-run] [--category <category>]`

- `--since`: Only pull memories created after this date. Default: 7 days ago.
- `--dry-run`: Show what would be synced without writing files.
- `--category`: Filter by Celune memory category (fact, preference, decision, context, general).

## Step 1: Connect to Supabase

**Read `~/.claude/skills/_shared/supabase-connect.md` for connection boilerplate.**

## Step 2: Fetch Remote Memories

Query Celune's agent_memory table for recent entries:

```python
import datetime

since = (datetime.date.today() - datetime.timedelta(days=7)).isoformat()
# Override with --since arg if provided

url = f"{SUPABASE_URL}/rest/v1/agent_memory?created_at=gte.{since}T00:00:00Z&order=created_at.desc&select=id,key,content,category,memory_type,importance_score,created_at"
```

If `--category` is specified, add `&category=eq.{category}` to the query.

## Step 3: Classify Each Memory

For each remote memory, classify into one of:

| Classification  | Criteria                                                                        | Local Destination                      |
| --------------- | ------------------------------------------------------------------------------- | -------------------------------------- |
| **Skip**        | Task outcome with no durable pattern; ephemeral context; already exists locally | None                                   |
| **Auto-memory** | Preference, decision, or feedback applicable across sessions                    | `~/.claude/projects/<project>/memory/` |
| **Knowledge**   | Architectural pattern, confirmed learning, reusable reference                   | `$VAULT_ROOT/05-knowledge/`            |
| **Project doc** | PRD, spec, or project-level artifact                                            | `$VAULT_ROOT/04-projects/`             |
| **Inbox**       | Raw idea or unprocessed thought needing triage                                  | `$VAULT_ROOT/00-inbox/`                |

### Deduplication Check

Before writing any file, check for duplicates:

1. Search existing auto-memory files for matching key/content
2. Search 05-knowledge/ for overlapping topics
3. If a memory updates an existing file, UPDATE rather than creating a duplicate

## Step 4: Present Curation Plan

Show a table of all fetched memories with proposed classification:

```
| # | Key | Category | Classification | Destination | Action |
|---|-----|----------|---------------|-------------|--------|
| 1 | github:pr-format | preference | Auto-memory | feedback_pr_workflow.md | Update existing |
| 2 | task-outcome:abc123 | fact | Skip | - | Ephemeral task detail |
| 3 | mcp:clearhealth | general | Project doc | 04-projects/clearhealth-prd.md | Already exists |
```

If `--dry-run`: stop here and show the table.

Otherwise, ask: "Proceed with sync? (Y to confirm, or specify row numbers to skip)"

## Step 5: Execute Sync

For each non-skipped memory:

### Auto-memory files

Use the standard frontmatter format:

```markdown
---
name: [descriptive name]
description: [one-line for relevance matching]
type: feedback|user|project|reference
---

[Content]

**Why:** [Rationale if available]
**How to apply:** [When this kicks in]
```

Update MEMORY.md index after all files are written.

### Knowledge files

Use the standard knowledge format:

```markdown
# Title

> Last updated: YYYY-MM-DD. Source: Celune memory sync.

## Key Points

- Bullet points

## Details

Expanded content where needed.

## Related

- [[related-knowledge-file]]
- [[related-project-file]]
  Expanded content where needed.
```

### Project docs

Write the full content. Add a backfill note at the top:

```markdown
> Backfilled from Celune memory on YYYY-MM-DD.
```

## Step 6: Report

```
Memory Sync Complete
--------------------
Fetched:  N remote memories (since YYYY-MM-DD)
Synced:   X files (Y new, Z updated)
Skipped:  W (duplicates/ephemeral)

New files:
  - path/to/new/file.md

Updated files:
  - path/to/updated/file.md

MEMORY.md: [updated/unchanged]
```

## Integration with /closing-time

When invoked from /closing-time, use these defaults:

- `--since` = date of last session log
- Auto-approve (no interactive confirmation)
- Include sync report in session log

## Principles

1. **Curate, don't dump.** Every synced memory should be useful in future sessions. Raw task outcomes with no durable pattern get skipped.
2. **Deduplicate aggressively.** Update existing files rather than creating duplicates.
3. **Local is canonical.** If local and remote conflict, local wins. Flag the conflict for manual review.
4. **Group related memories.** Multiple related preferences become one file, not many.
