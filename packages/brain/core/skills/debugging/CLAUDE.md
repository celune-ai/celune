---
name: debugging
description: "Structured debugging protocol for diagnosing and fixing issues.\n  TRIGGER when: the agent encounters a failing test, type error, runtime error, or unexpected behavior that isn't immediately obvious.\n  This is a protocol skill — it guides HOW to debug, not WHEN to start."
user_invocable: false
---

# Debugging Protocol

A structured approach to diagnosing and fixing issues. Use this protocol when a problem isn't immediately obvious and requires systematic investigation.

## When to Use

- Test failures that aren't caused by the code you just wrote
- Type errors in code you didn't modify
- Runtime errors with unclear stack traces
- Behavior that doesn't match expectations
- Build failures after seemingly unrelated changes

## Protocol

### Step 1: Reproduce

Before fixing anything, confirm the problem is reproducible:

```bash
# Run the specific failing test/check
pnpm type-check
pnpm test -- --run <test-file>
pnpm build
```

Note the exact error message, file, and line number.

### Step 2: Isolate

Narrow down the cause:

1. **Read the error message carefully.** Most errors tell you exactly what's wrong.
2. **Check recent changes.** What files were modified since it last worked?
   ```bash
   git diff --name-only HEAD~3
   ```
3. **Check if it's a dependency issue:**
   ```bash
   pnpm install
   ```
4. **Check if the error exists on main:**
   ```bash
   git stash && pnpm type-check && git stash pop
   ```

### Step 3: Understand

Before writing a fix:

1. **Read the relevant source code.** Don't guess — read the actual implementation.
2. **Trace the data flow.** Follow the path from input to error.
3. **Check types.** Are the types correct? Is there a mismatch between what's expected and what's provided?
4. **Check imports.** Wrong import paths are a common source of subtle errors.

### Step 4: Fix

Apply the minimal fix:

1. **Fix the root cause, not the symptom.** Type casts and `as any` are band-aids.
2. **One change at a time.** Don't fix multiple things simultaneously.
3. **Verify after each change:**
   ```bash
   pnpm type-check && pnpm test
   ```

### Step 5: Verify

Confirm the fix doesn't break anything else:

```bash
pnpm type-check && pnpm build && pnpm test
```

If new failures appear, you may have found a deeper issue. Return to Step 2.

## Anti-Patterns

- **Don't add `as any` or `@ts-ignore` to suppress errors.** Fix the underlying type.
- **Don't delete tests that fail.** Fix the code or update the test expectation.
- **Don't guess and check.** Read the code first, understand the problem, then fix.
- **Don't make large changes to fix small bugs.** The fix should be proportional to the problem.
- **Don't ignore warnings.** They often predict future errors.

## Escalation

If you've spent more than 15 minutes on a single issue:

1. Document what you've tried
2. Document what you've learned about the problem
3. Flag it as blocked and move on
4. Create a task with the debugging context for follow-up
