---
name: security-audit
description: 'Full security audit — automated scans, manual code review, findings report, auto-fix critical issues.'
user_invocable: true
requires:
  bins: [node, pnpm]
---

# security-audit

Full security audit of the celune-platform monorepo. Runs automated scans, then manual code review, produces a findings report.

**Repo:** `$CELUNE_REPO/`
**Stack:** Next.js 16, React 19, Supabase, pnpm monorepo (Turborepo)
**Apps:** web (3000), admin (3002), docs (3001)

---

## 1. Determine Scope

Ask the user (or infer from context) which scope to audit:

| Scope     | What it covers                                    |
| --------- | ------------------------------------------------- |
| `full`    | All apps, packages, infra, dependencies (default) |
| `admin`   | Admin app only (API routes, auth, task board)     |
| `web`     | Public web app only                               |
| `api`     | API routes across all apps                        |
| `deps`    | Dependency audit only (fast)                      |
| `secrets` | Secret scanning only (fast)                       |

If no scope specified, default to `full`.

---

## 2. Run Automated Scan

Execute the automated scanner first to catch low-hanging fruit:

```bash
bash ~/.claude/skills/security-audit/scripts/automated-scan.sh $CELUNE_REPO
```

Capture the output. This checks: dependency CVEs, hardcoded secrets, .env tracking, gitignore coverage, service key usage, client-side key exposure, security headers, and TypeScript strict mode.

---

## 3. Manual Code Review

Load the detailed checklist: [references/checklist.md](references/checklist.md)

Work through the checklist categories relevant to the scope. For each category:

1. Use Grep/Glob to search for the patterns described
2. Read suspect files for context
3. Record findings with severity (Critical / High / Medium / Low)

**Parallelize where possible.** Spawn Explore sub-agents for independent categories:

- Agent 1: Auth & API routes (checklist sections 1-2)
- Agent 2: Database & secrets (sections 3-4)
- Agent 3: Injection & XSS (sections 5-6)
- Agent 4: Headers, deps, infra, client-side (sections 7-10)

### Stack-Specific Checks

**Next.js:**

- Verify `middleware.ts` covers all protected routes
- Check Server Actions validate auth (not just API routes)
- Confirm `serverExternalPackages` doesn't expose internals
- Check `next.config.ts` for `poweredByHeader: false`

**Supabase:**

- Verify RLS policies on every table with user data
- Check that `createServiceClient()` is only in `route.ts` files (never in components)
- Confirm anon key vs service key usage is correct
- Review any `.rpc()` calls for SQL injection

**React/Client:**

- Search for `dangerouslySetInnerHTML`
- Check that `useEffect` fetches don't leak auth tokens in URLs
- Verify no sensitive data in React state that persists across routes

---

## 4. Compile Findings Report

Present findings as a table sorted by severity:

```markdown
## Security Audit Report — YYYY-MM-DD

### Summary

- Critical: X | High: X | Medium: X | Low: X
- Scope: [full/admin/web/api/deps/secrets]

### Findings

| #   | Severity | Category | Finding | File(s) | Recommendation |
| --- | -------- | -------- | ------- | ------- | -------------- |
| 1   | Critical | ...      | ...     | ...     | ...            |
```

### Severity Definitions

- **Critical:** Exploitable now, data exposure or auth bypass. Fix immediately.
- **High:** Significant risk, likely exploitable with some effort. Fix this sprint.
- **Medium:** Defense-in-depth gap. Schedule fix.
- **Low:** Best practice improvement. Address opportunistically.

---

## 5. Fix Safe Issues

For Critical and High findings that have safe, obvious fixes:

- Apply the fix directly
- Run `pnpm --filter platform type-check` (or relevant app) after
- Note which findings were auto-fixed in the report

Skip fixes that are risky, large-scope, or require the user's input.

---

## 6. Create Tasks for Remaining Issues

For each unfixed finding (High or above), create a Supabase inbox task:

```bash
node packages/db/scripts/task-cli.mjs create \
  "Security: [brief description]" \
  --priority high \
  --category infra --category code-quality \
  --description "## What\n[finding]\n\n## Value\n[risk if unaddressed]\n\n## Approach\n[fix steps]\n\n## Sequence\n[dependencies]\n\n## Blockers\nNone"
```

Tag all security tasks with `infra` and `code-quality`.

---

## 7. Present Summary

End with:

- Total findings by severity
- Which were auto-fixed
- Which have inbox tasks
- Top 3 recommendations for the user
- Comparison to last audit (if previous report exists in `memory/sessions/`)
