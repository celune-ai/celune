---
name: deep-build
description: "Iterative deep-focus build mode with verification after every iteration.\n  TRIGGER when: the user says '/deep-build', 'deep build', 'iterative build', or wants high-quality implementation with verification loops.\n  DO NOT TRIGGER when: standard builds (/build), AFK building (/afk-building), or task creation (/task)."
user_invocable: true
requires:
  bins: [node, pnpm]
---

# /deep-build — Iterative Deep Focus Build

A verification-heavy build mode for tasks where quality matters more than speed. Unlike `/build` which does a single pass, `/deep-build` runs a verification loop after every iteration.

## Arguments

`/deep-build <task UUID or description>`

## When to Use

- Effort=L or XL tasks that touch many files
- Tasks involving security, auth, or data integrity
- When the user explicitly requests iterative verification
- Complex refactors that could introduce regressions

## Workflow

### Step 1: Claim & Plan

1. Claim the task: `node packages/db/scripts/task-cli.mjs claim <task-id> --agent lead`
2. Write a detailed RFC (Problem, Solution, Technical Approach, Testing Strategy)
3. Break the RFC into numbered iterations (each iteration = one logical unit of change)

### Step 2: Iterative Build Loop

For each iteration:

1. **Implement** the iteration's changes
2. **Verify immediately:**
   ```bash
   pnpm type-check && pnpm build && pnpm test
   ```
3. **If verification fails:** Fix before proceeding to next iteration
4. **Commit** the passing iteration with a descriptive message
5. **Log** what was done and what's next

### Step 3: Final Verification

After all iterations:

1. Run full verification suite: `pnpm type-check && pnpm build && pnpm test && npx prettier --check .`
2. Review the complete diff for any regressions
3. Write completion report to task outcome

### Step 4: Complete

```bash
node packages/db/scripts/task-cli.mjs complete <task-id> --agent lead \
  --outcome "Concise summary of iterations completed, files changed, and verification results."
```

## Key Difference from /build

| Aspect       | /build                   | /deep-build                     |
| ------------ | ------------------------ | ------------------------------- |
| Verification | After each sprint        | After each iteration (sub-task) |
| Scope        | Full project or task     | Single task only                |
| Speed        | Optimized for throughput | Optimized for correctness       |
| Best for     | Projects, multiple tasks | Complex single tasks            |

## TODO

<!-- This is a minimal template. Expand with iteration tracking, rollback support, and progress reporting as the skill matures. -->
