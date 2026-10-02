---
name: code-review
description: "Protocol for performing structured code reviews.\n  TRIGGER when: reviewing PRs, performing code review closing tasks, or when the user requests a review of specific changes.\n  This is a protocol skill — it guides HOW to review code, not WHEN to start."
user_invocable: false
---

# Code Review Protocol

Structured approach to reviewing code changes. Used during closing tasks, PR reviews, and ad-hoc review requests.

## When to Use

- Code Review closing task in a project
- PR review requested by the user
- Ad-hoc review of specific files or changes
- Pre-merge verification

## Review Checklist

### 1. Correctness

- Does the code do what the task/PR description says?
- Are all edge cases handled?
- Are error states handled gracefully?
- Does the logic match the PRD requirements (if applicable)?

### 2. Security

- No hardcoded secrets, API keys, or tokens
- Service keys only used server-side (`createServiceClient()` in route handlers only)
- Input validation at API boundaries
- RLS policies on new tables
- No SQL injection via `.rpc()` or raw queries
- No `dangerouslySetInnerHTML` without sanitization
- CORS and auth middleware covering new routes

### 3. Quality

- TypeScript types are correct and complete (no `any` unless justified)
- No dead code, commented-out blocks, or unused imports
- Functions are focused (single responsibility)
- Naming is clear and consistent with codebase conventions
- No duplicated logic that should be extracted
- File size is reasonable (<300 lines for components)

### 4. Performance

- No unnecessary re-renders (React)
- Database queries are efficient (indexed, no N+1)
- Large lists are paginated or virtualized
- No synchronous operations that should be async

### 5. Testing

- Tests exist for new functionality
- Tests cover happy path AND error cases
- Tests are deterministic (no flaky tests)
- Mocks are at boundaries (database, external APIs), not internal functions

### 6. Formatting & Style

```bash
npx prettier --check .
pnpm lint
```

Fix any issues before completing the review.

## Review Output Format

```markdown
## Code Review — {project/PR name}

### Summary

{1-2 sentences on overall quality}

### Findings

| #   | Severity | Category | Finding                              | File                   | Line |
| --- | -------- | -------- | ------------------------------------ | ---------------------- | ---- |
| 1   | High     | Security | Service key used in client component | src/app/page.tsx       | 42   |
| 2   | Medium   | Quality  | Duplicated validation logic          | src/api/tasks/route.ts | 15   |

### Automated Checks

| Check      | Result          |
| ---------- | --------------- |
| Type check | PASS/FAIL       |
| Build      | PASS/FAIL       |
| Tests      | PASS/FAIL (N/N) |
| Prettier   | PASS/FAIL       |
| Lint       | PASS/FAIL       |

### Verdict

APPROVE / REQUEST_CHANGES / COMMENT
```

## Severity Definitions

- **Critical:** Security vulnerability, data loss risk, auth bypass. Must fix before merge.
- **High:** Bug, significant quality issue, missing validation. Should fix before merge.
- **Medium:** Code quality, performance, maintainability. Should fix, can defer if justified.
- **Low:** Style, naming, minor optimization. Nice to have, not blocking.

## Process

### For Closing Tasks

1. Claim the code review task
2. Run automated checks: `pnpm type-check && pnpm build && pnpm test && npx prettier --check .`
3. Review all changes in the project (read diffs, check against PRD)
4. Write findings to task outcome
5. Post findings as task comment
6. For each Critical/High finding: create a fix task with `--spawned-by`
7. Execute fix tasks immediately
8. Re-run verification after fixes
9. Complete the code review task

### For PR Reviews

1. Read the PR description and linked tasks
2. Review the diff: `git diff main...HEAD`
3. Run automated checks locally
4. Submit review via GitHub (approve/request changes)
5. For requested changes: specify exactly what needs to change
