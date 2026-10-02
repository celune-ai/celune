# performance-audit

Full performance audit of the celune monorepo. Runs automated scans, parallel manual review, produces findings report, auto-fixes safe issues, and creates a PR.

**Repo:** `$CELUNE_REPO/`
**Stack:** Next.js 16, React 19, Supabase, pnpm monorepo (Turborepo)
**Apps:** platform (3002), admin (3003)

---

## 1. Determine Scope

Ask the user (or infer from context) which scope to audit:

| Scope      | What it covers                                                   |
| ---------- | ---------------------------------------------------------------- |
| `full`     | All apps, packages, rendering, DB queries, bundle, API (default) |
| `platform` | Platform app only                                                |
| `admin`    | Admin app only                                                   |
| `api`      | API routes and DB queries only                                   |
| `bundle`   | Bundle size and client-side JS only (fast)                       |
| `db`       | Database queries and N+1 patterns only (fast)                    |

If no scope specified, default to `full`.

---

## 2. Run Automated Scan

Execute the automated scanner first to catch measurable issues:

```bash
bash ~/.claude/skills/performance-audit/scripts/automated-scan.sh $CELUNE_REPO
```

Capture the output. This checks: bundle analysis, unused dependencies, large imports, dynamic imports, image optimization, React re-render risks, DB query patterns, API response sizes, and build performance.

---

## 3. Manual Code Review

Load the detailed checklist: [references/checklist.md](references/checklist.md)

Work through the checklist categories relevant to the scope. For each category:

1. Use Grep/Glob to search for the patterns described
2. Read suspect files for context
3. Record findings with impact (Critical / High / Medium / Low)

**Parallelize where possible.** Spawn Explore sub-agents for independent categories:

- Agent 1: React rendering & client-side performance (sections 1-2)
- Agent 2: API routes & database queries (sections 3-4)
- Agent 3: Bundle size & asset optimization (sections 5-6)
- Agent 4: Build config, caching & infrastructure (sections 7-8)

### Stack-Specific Checks

**Next.js:**

- Verify dynamic imports for heavy components (code editors, charts, markdown renderers)
- Check for missing `loading.tsx` / Suspense boundaries on data-fetching routes
- Confirm `next/image` used instead of `<img>` tags
- Check `next.config.ts` for experimental features that improve performance
- Verify `generateStaticParams` used where possible for static generation
- Check for unnecessary `'use client'` directives (server components preferred)

**Supabase:**

- Check for N+1 query patterns (fetching in loops)
- Verify indexes exist for frequently filtered/sorted columns
- Check for missing `.select()` column restrictions (SELECT \* waste)
- Review any `.rpc()` calls for query plan efficiency
- Check for unnecessary real-time subscriptions

**React/Client:**

- Search for missing `useMemo`/`useCallback` on expensive computations
- Check for inline object/array literals in JSX props (causes re-renders)
- Verify large lists use virtualization (react-window, tanstack-virtual)
- Check for state updates in loops or rapid-fire handlers without batching
- Verify images use proper sizing, lazy loading, and modern formats

---

## 4. Compile Findings Report

Present findings as a table sorted by impact:

```markdown
## Performance Audit Report — YYYY-MM-DD

### Summary

- Critical: X | High: X | Medium: X | Low: X
- Scope: [full/platform/admin/api/bundle/db]

### Findings

| #   | Impact   | Category | Finding | File(s) | Recommendation | Effort |
| --- | -------- | -------- | ------- | ------- | -------------- | ------ |
| 1   | Critical | ...      | ...     | ...     | ...            | S/M/L  |
```

### Impact Definitions

- **Critical:** Measurable user-facing latency (>500ms delay, LCP regression, blocked rendering). Fix immediately.
- **High:** Significant waste (large bundle imports, N+1 queries, unnecessary re-renders on hot paths). Fix this sprint.
- **Medium:** Defense-in-depth optimization. Schedule fix.
- **Low:** Best practice improvement. Address opportunistically.

---

## 5. Fix Safe Issues

For Critical and High findings that have safe, obvious fixes:

- Apply the fix directly (dynamic imports, missing indexes, select column restrictions, memo additions)
- Run `pnpm type-check` after each batch of fixes
- Run `pnpm build` after all fixes to verify nothing breaks
- Note which findings were auto-fixed in the report

**Safe to auto-fix:**

- Adding `dynamic import()` for heavy components
- Restricting `.select('*')` to explicit columns (when column usage is clear from the consumer)
- Adding missing `loading.tsx` Suspense boundaries
- Converting `<img>` to `next/image`
- Adding `useCallback`/`useMemo` where dependency arrays are obvious
- Adding database indexes (via migration)
- Removing unused imports/dependencies

**Skip fixes that:**

- Change component behavior or API contracts
- Require large refactors (e.g., full virtualization retrofit)
- Need the user's input on UX tradeoffs
- Could affect data loading patterns users depend on

---

## 6. Create Tasks for Remaining Issues

For each unfixed finding (High or above), create a Supabase inbox task:

```bash
node packages/db/scripts/task-cli.mjs create \
  --title "Perf: [brief description]" \
  --priority high \
  --description "## What\n[finding]\n\n## Value\n[expected improvement]\n\n## Approach\n[fix steps]\n\n## Sequence\n[dependencies]\n\n## Blockers\nNone"
```

---

## 7. Create PR

Branch from `origin/main`, commit all fixes, push, create PR with:

- Summary of findings
- Which were auto-fixed (with before/after metrics if measurable)
- Tests table (type-check + build + test + prettier)
- Follow-up tasks for unfixed findings

---

## 8. Present Summary

End with:

- Total findings by impact
- Which were auto-fixed
- Which have inbox tasks
- Top 3 recommendations for the user
- Bundle size delta (if measurable)
- Build time delta (if measurable)
