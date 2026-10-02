# Security Audit Report

**Date:** 2026-04-27
**Branch:** `rick/overnight-audit-and-housekeeping`
**Auditor:** RICK (automated agent)
**Scope:** `apps/platform/` -- all API routes, middleware, auth, RLS, dependencies

---

## Executive Summary

The Celune platform has a strong security foundation. Middleware enforces authentication, RBAC, CSRF protection, and global rate limiting on all API routes. A static analysis test suite (`security-invariants.test.ts`) automatically catches new routes missing security patterns. RLS has been hardened across three migration phases. Two dependency vulnerabilities exist upstream in dev-only packages.

**Findings:** 0 Critical, 1 High, 4 Medium, 4 Low

---

## Findings

| #   | Severity | Category         | Finding                                                                              | Status       |
| --- | -------- | ---------------- | ------------------------------------------------------------------------------------ | ------------ |
| 1   | High     | Error Handling   | Provider-keys route leaks raw `err.message` to client                                | **Fixed**    |
| 2   | Medium   | Error Handling   | `ProviderKeyRequiredError.message` exposed in 4 routes                               | Acceptable   |
| 3   | Medium   | Dependencies     | `flatted` prototype pollution (CVE via pnpm audit)                                   | Needs Review |
| 4   | Medium   | Dependencies     | `picomatch` ReDoS in eslint devDep chain                                             | Needs Review |
| 5   | Medium   | Input Validation | 81/~130 API routes use Zod schemas; ~49 routes lack explicit schema                  | Needs Review |
| 6   | Low      | Error Handling   | `knowledge/search` route exposes RPC-missing hint to client                          | Documented   |
| 7   | Low      | Auth             | Routes flagged "NO_AUTH_CHECK" mostly rely on middleware-level auth                  | Verified OK  |
| 8   | Low      | RLS              | All tables have RLS enabled; Phase 3 hardening removed NULL bypasses                 | Verified OK  |
| 9   | Low      | Secrets          | No hardcoded secrets in source; test files use obvious fakes (`xoxb-fake-bot-token`) | Verified OK  |

---

## Detailed Findings

### 1. [High] Provider-keys route leaks raw error message (FIXED)

**File:** `src/app/api/provider-keys/route.ts:128`
**Before:** `Key validation failed: ${err instanceof Error ? err.message : 'network error'}`
**Risk:** Raw exception messages from fetch failures (DNS errors, TLS errors, etc.) could expose internal infrastructure details.
**Fix:** Replaced with generic message, added server-side logging.

### 2. [Medium] ProviderKeyRequiredError.message exposed in responses

**Files:**

- `src/app/api/agents/[id]/chat/route.ts:340`
- `src/app/api/support/chat/route.ts:176`
- `src/app/api/voice/parse/route.ts:296`
- `src/app/api/voice/transcribe/route.ts:98`

**Risk:** Low in practice. The `ProviderKeyRequiredError` message is a controlled string (`"Trial budget exhausted. Please add your own {provider} API key to continue."` or similar). This is intentional UX, not a raw error leak. Classified as Medium because the pattern of passing `error.message` directly could be copied to less-safe contexts.
**Recommendation:** Consider a `userMessage` getter on `ProviderKeyRequiredError` to make the intent explicit.

### 3. [Medium] Prototype pollution in `flatted` (dependency)

**Package:** `flatted` <= 3.4.1
**Severity:** High (per npm advisory)
**Impact:** Transitive dev dependency. Not used in production API routes. Exploitability requires attacker-controlled input to `flatted.parse()`.
**Recommendation:** Update when patched version available. Monitor advisory.

### 4. [Medium] ReDoS in `picomatch` (devDep chain)

**Package:** `picomatch` 2.3.1 (via `eslint-config-next` > `fast-glob` > `micromatch`)
**Severity:** High (per npm advisory)
**Impact:** Dev-only; not reachable in production. Affects eslint glob matching with malicious patterns.
**Recommendation:** Update `eslint-config-next` when a patched chain is available.

### 5. [Medium] API routes without explicit Zod schemas

**Stats:** 81 of ~130 route files import Zod schemas. The remaining routes either:

- Use `withApiSecurity({ parseBody: schema })` (counted in the 81)
- Are GET-only routes with query param validation via `searchParams`
- Are webhook receivers validating via HMAC/signature
- Are a handful of simple routes that should add schema validation

**Higher-risk routes without schemas** (mutation endpoints):

- Task sub-routes (`spawned`, `context`, `dependencies`, `usage`, `children`) rely on middleware auth but lack body schema validation
- `skill-packs/[slug]/install` -- mutation without explicit schema

**Recommendation:** Add Zod schemas to all POST/PUT/PATCH handlers. The `withApiSecurity` wrapper makes this easy.

### 6. [Low] Knowledge search RPC hint exposed

**File:** `src/app/api/knowledge/search/route.ts:92`
**Detail:** When the knowledge RPC function doesn't exist, the error message says "Knowledge search RPC not yet deployed. Run the knowledge migration first." This is a deployment hint, not a security leak per se, but it reveals internal architecture to authenticated users.
**Recommendation:** Change to generic "Knowledge search is not available" in production.

### 7. [Low] Routes without in-handler auth -- verified OK

Many routes flagged as "NO_AUTH_CHECK" in static grep (no `withApiSecurity`/`requirePermission`/`requireAuth` in the file) actually rely on:

- **Middleware-level auth** (`middleware.ts` checks session/API key for all non-public `/api/` routes)
- **Middleware RBAC** (permission checks via `API_ROUTE_PERMISSIONS` map)
- **Public routes** (correctly listed in `PUBLIC_API_PREFIXES`)
- **Webhook routes** with their own HMAC/signature verification (hooks/notify, discord/interactions, etc.)
- **Cron routes** with `CRON_SECRET` validation via `timingSafeEqual`

The middleware-first auth model is defense-in-depth. No routes are accidentally public.

### 8. [Low] RLS coverage -- verified OK

All tables have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. Three hardening migrations have been applied:

- `20260329_fix_rls_misconfigurations.sql` -- fixed PUBLIC access on `portfolio_passwords` and `workspace_github_tokens`
- `20260403_security_phase3_rls_hardening.sql` -- removed `workspace_id IS NULL` bypasses, scoped `agent_configs`, consolidated SECURITY DEFINER functions

### 9. [Low] Secrets scan -- clean

No hardcoded API keys, tokens, or credentials in source. All matches are:

- Placeholder patterns in `.env.example` (`sk-ant-...`)
- PII detection regexes in guardrails (`/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g`)
- Test fixtures with obvious fakes (`xoxb-fake-bot-token`)
- `.env` and `.env.local` are properly gitignored

---

## Architecture Strengths

| Area                | Assessment                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Middleware auth** | Solid. Fail-closed on errors. Strips incoming `x-user-id` to prevent spoofing.                                                     |
| **CSRF**            | Origin validation on all mutations except exempt webhook/CLI routes. CSRF-exempt list is well-documented.                          |
| **Rate limiting**   | Two layers: global middleware (300 read/120 write per 60s) + per-route `applyRateLimit`/`withApiSecurity` for sensitive endpoints. |
| **RBAC**            | Permission-based access control with workspace scoping. `resolvePermissions` checks workspace membership.                          |
| **API key auth**    | `celune_` prefix, minimum 39-char length, hash comparison via `api_keys` table. Separate from session auth.                        |
| **Error handling**  | `safeErrorResponse` maps known DB errors to safe messages. `ApiError` class separates user-facing from internal messages.          |
| **Guardrails**      | PII detection and API key redaction in agent output (`output-rail.ts`, `pii-detector.ts`).                                         |
| **Security tests**  | `security-invariants.test.ts` statically verifies all routes have required patterns.                                               |
| **Audit logging**   | `security_audit_log` table with immutable trail for sensitive operations.                                                          |

---

## Recommendations (Priority Order)

1. **Add Zod schemas to remaining mutation routes** (Finding #5) -- highest ROI for input validation coverage
2. **Update `flatted`** when patched version ships (Finding #3)
3. **Consider explicit `userMessage` property** on `ProviderKeyRequiredError` to prevent future copy-paste of `error.message` pattern (Finding #2)
4. **Genericize knowledge search RPC error** in production (Finding #6)
5. **Run `pnpm audit` in CI** to catch new advisories automatically

---

_Report generated by RICK security audit agent. Fixes committed to `rick/overnight-audit-and-housekeeping`._
