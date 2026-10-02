# Error Reduction Metrics

Baseline metrics for measuring AI coding error reduction.

## Metrics (per task)

| Metric            | Key                 | Type    | Description                                               |
| ----------------- | ------------------- | ------- | --------------------------------------------------------- |
| Test Failures     | `test_failures`     | integer | Number of test failures encountered during implementation |
| Rework Count      | `rework_count`      | integer | Times task was reopened or sent back from review          |
| QA Bugs           | `qa_bugs`           | integer | Bugs found during QA/review                               |
| Review Rejections | `review_rejections` | integer | Code review rejections before passing                     |

## Where Metrics Live

Metrics are stored in the existing `metadata` jsonb column under a `metrics` key:

```json
{
  "claimed_by": "agent-name",
  "active_session": false,
  "metrics": {
    "test_failures": 0,
    "rework_count": 0,
    "qa_bugs": 0,
    "review_rejections": 0
  }
}
```

**Why `metadata.metrics` instead of a separate column:** The metadata column already exists, is jsonb, and is used by all agents via task-cli. Nesting under a `metrics` key keeps it organized without a schema migration. Querying is straightforward with Postgres jsonb operators (`metadata->'metrics'->>'test_failures'`).

## How to Record

### On Task Completion

When completing a task, agents should update metadata with metrics before calling `complete`:

```bash
# Step 1: Record metrics (manual Supabase update or future CLI flag)
# For now, agents self-report in task comments:
node packages/db/scripts/task-cli.mjs comment <task-id> \
  --author <agent-name> \
  --content "metrics: test_failures=0, rework_count=0, qa_bugs=0, review_rejections=0"

# Step 2: Complete the task as normal
node packages/db/scripts/task-cli.mjs complete <task-id> --agent <agent-name>
```

### When to Increment

| Event                                              | Metric              | Who Records        |
| -------------------------------------------------- | ------------------- | ------------------ |
| `vitest` / `pnpm test` fails during implementation | `test_failures`     | Implementing agent |
| Task moved back from `review` -> `in_progress`     | `rework_count`      | Reviewing agent    |
| Bug found during QA that requires a fix            | `qa_bugs`           | QA agent           |
| PR review requests changes                         | `review_rejections` | Reviewing agent    |

### Baseline Period

- **Start date:** First day of metric collection
- **Baseline window:** First 30 days of metric collection
- **Measurement checkpoints:** 30-day and 90-day post-baseline

## Reporting

Run the metrics report script:

```bash
node scripts/error-metrics-report.mjs           # All time
node scripts/error-metrics-report.mjs --days 30  # Last 30 days
```

## Future Enhancements

- Add `--metrics` flag to task-cli `complete` command for inline recording
- Admin dashboard chart showing metrics trends over time
- Automated rework detection when task status moves backward
