# Performance Audit -- Celune Platform

**Date:** 2026-04-24
**Branch:** `rick/overnight-audit-and-housekeeping`
**Auditor:** RICK (automated)

---

## Summary

| Severity | Count |
| -------- | ----- |
| Critical | 2     |
| High     | 6     |
| Medium   | 8     |
| Low      | 5     |

---

## 1. Middleware Performance

### CRITICAL: Middleware runs DB queries on every request

**File:** `apps/platform/src/middleware.ts`

The middleware matcher `['/((?!_next/static|_next/image|favicon.ico).*)']` runs on virtually every request. For authenticated API routes AND page routes, it:

1. Calls `updateSession()` (Supabase token refresh, 1 DB round-trip)
2. Calls `resolvePermissions()` (1 RPC call, or 3-5 queries via fallback)
3. Looks up workspace by slug (1 additional query for page routes)

This means every single page navigation and API call incurs 2-6 database round-trips in middleware alone, before the actual route handler executes.

**Impact:** 50-200ms added to every request. At scale, this is the single biggest latency contributor.

**Recommendation:**

- Cache `resolvePermissions` results in a short-lived in-memory LRU (30s TTL, keyed by `userId:workspaceId`)
- Skip permission resolution entirely for static assets and public pages (the matcher already skips `_next/static` but not font files, images in `/public`, etc.)
- Add explicit exclusions for known-public API routes (e.g., `/api/readiness`, `/api/brain/manifest`)

**Status:** Not fixed (requires careful testing; middleware caching is high-risk for stale permissions)

---

### HIGH: Middleware fallback does N+1 permission queries

**File:** `apps/platform/src/lib/permissions.ts`

When the `resolve_user_permissions` RPC is unavailable, `resolvePermissionsFallback()` executes 3-5 sequential queries:

1. `user_roles` lookup
2. `org_members` lookup
3. `workspace_memberships` lookup
4. `role_permissions` lookup
5. Conditional additional lookups

These run sequentially, not in parallel.

**Recommendation:** Wrap fallback queries in `Promise.all()` where they don't depend on each other. Better yet, ensure the RPC is always deployed so the fallback never triggers.

**Status:** Not fixed (fallback path; needs RPC deployment verification first)

---

## 2. Bundle Size

### HIGH: Heavy dependencies in client bundle

**File:** `apps/platform/package.json`

Notable large dependencies:

- `@anthropic-ai/sdk` (^0.78.0) -- AI SDK, likely only used server-side but may leak into client bundle
- `@google/generative-ai` (^0.24.1) -- same risk
- `@modelcontextprotocol/sdk` (1.27.1) -- server-only, verify not imported client-side
- `@sentry/nextjs` (^10.40.0) -- necessary but large; verify tree-shaking works
- `recharts` (peer dep in @repo/ui) -- large charting library, verify it's code-split
- `framer-motion` (^12.38.0) -- 30KB+ gzipped, imported in @repo/ui

**Recommendation:**

- Run `ANALYZE=true pnpm build` and review the bundle analyzer output
- Ensure AI SDKs are only imported in server components / API routes (add `'server-only'` imports)
- Consider `next/dynamic` for recharts-heavy dashboard components

**Status:** Not fixed (requires bundle analysis run)

---

### MEDIUM: Voice providers eagerly instantiate all providers

**File:** `apps/platform/src/lib/voice-providers/index.ts`

```typescript
const PROVIDERS: Record<string, VoiceProviderInterface> = {
  elevenlabs: new ElevenLabsProvider(),
  openai: new OpenAITTSProvider(),
};
```

Both providers are instantiated at import time, even if only one is ever used. The comment says "lazy imports prevent unused providers from loading" but the code eagerly instantiates.

**Recommendation:** Use lazy initialization pattern:

```typescript
const PROVIDERS: Record<string, () => VoiceProviderInterface> = {
  elevenlabs: () => new ElevenLabsProvider(),
  openai: () => new OpenAITTSProvider(),
};
```

**Status:** Not fixed (low risk, server-only code)

---

### MEDIUM: Knowledge connectors barrel imports all connectors

**File:** `apps/platform/src/lib/knowledge/connectors/index.ts`

Imports all 12 connector modules (Notion, GitHub, Google Drive, Gmail, Linear, Asana, Confluence, Dropbox, Figma, Google Calendar, Upload, URL Crawl) at the top level. Each connector may pull in its own dependencies.

**Recommendation:** Use dynamic imports in the `CONNECTORS` map's `syncFunction`:

```typescript
syncFunction: async (p) => {
  const { syncNotion } = await import('./notion');
  return syncNotion({ ... });
}
```

**Status:** Not fixed (server-only, but affects cold start time)

---

## 3. Database Queries

### CRITICAL: usage_events query with .limit(10000) in analytics

**File:** `apps/platform/src/app/api/analytics/usage/route.ts`

```typescript
let currentQuery = supabase
  .from('usage_events')
  .select('event_type, quantity, unit')
  .gte('created_at', monthStart.toISOString())
  .limit(10000);
```

A limit of 10,000 rows for real-time aggregation is dangerously high. This should be a database-level aggregation (RPC or materialized view), not client-side processing of 10K rows.

**Impact:** Response times of 2-10 seconds for active workspaces; potential timeout under load.

**Recommendation:**

- Create a Supabase RPC that does `SELECT event_type, SUM(quantity) FROM usage_events WHERE ... GROUP BY event_type`
- Or use the existing `usage_summaries` table exclusively and update it more frequently

**Status:** Not fixed (requires DB migration for RPC)

---

### HIGH: 16 instances of .select('\*') in production code

**Files:** `agent-loader.ts`, `github-org.ts`, `claim-job.ts`, `get-task.ts`, `get-project.ts`, `toggle/route.ts`, `cost/summary/route.ts`, `usage/route.ts`, `knowledge/sources/[id]/route.ts`, `waitlist/route.ts`, `detect-installation/route.ts`, `callbacks.ts`

Using `select('*')` fetches all columns including potentially large `metadata` JSONB fields, `description` text, and `content` blobs. This wastes bandwidth and memory.

**Recommendation:** Replace with explicit column lists matching what the code actually uses. Example for `agent-loader.ts`:

```typescript
.select('agent_id, workspace_id, display_name, role, description, agent_type, model, color, persona_prompt, capabilities, parameters, permissions, is_active')
```

**Status:** Not fixed (safe change but tedious; prioritize high-traffic routes first)

---

### HIGH: agent-loader waterfall queries

**File:** `apps/platform/src/lib/agent-loader.ts`

`loadOrgSharedAgents()` makes 3 sequential queries:

1. Fetch workspace to get `org_id`
2. Fetch organization to check `metadata.sharing_enabled`
3. Fetch shared agents

These could be a single join or at minimum parallelized (queries 1+2 don't depend on each other if you pass both IDs).

**Recommendation:** Create an RPC `get_org_shared_agents(workspace_id)` that does this in one round-trip, or at minimum combine into a join query.

**Status:** Not fixed (requires RPC or query restructuring)

---

### MEDIUM: cost/summary route fetches all rows with select('\*')

**File:** `apps/platform/src/app/api/analytics/cost/summary/route.ts`

Fetches all cost summary rows with `select('*')` without a limit. For workspaces with long history, this grows unbounded.

**Recommendation:** Add `.limit(500)` and ensure the client paginates or uses date-range filters.

**Status:** Not fixed

---

## 4. React Rendering

### HIGH: Only 8 files use next/image; 10+ use raw `<img>` tags

**Files using `<img>`:**

- `agents/page.tsx:392` -- agent icons
- `integration-dialog.tsx:307` -- integration logos
- `integration-detail-drawer.tsx:195` -- integration logos
- `ide-setup-panel.tsx:34` -- IDE icons
- `team-template-picker.tsx:159` -- avatars
- `support-widget.tsx:376` -- agent avatar
- `avatar-picker.tsx:193` -- avatar grid
- `agent-avatar.tsx:30` -- agent avatar
- `connections-step.tsx:42` -- connection icons
- `waitlist/route.ts:183` -- email template (acceptable)

Raw `<img>` tags skip Next.js image optimization (lazy loading, responsive sizing, WebP conversion, blur placeholders).

**Recommendation:** Replace with `next/image` for all user-facing images. Keep `<img>` only in email templates and cases where the image source is truly dynamic/external and can't be configured in `next.config.ts` `remotePatterns`.

**Status:** Not fixed (safe but tedious change)

---

### MEDIUM: Zero React.memo usage across 100+ components

No components use `React.memo()`. The largest components are:

- `onboarding-wizard.tsx` (1,268 lines)
- `onboarding-fullscreen.tsx` (1,119 lines)
- `agent-lead-wizard.tsx` (1,082 lines)
- `settings-workspace-tab.tsx` (1,001 lines)
- `task-drawer-details.tsx` (754 lines)
- `memory-graph.tsx` (717 lines)

**Recommendation:** Prioritize memoization for:

1. List item components rendered in `.map()` calls (task-row, memory-card, agent cards)
2. Heavy child components in settings tabs (already using dynamic imports, which helps)
3. Components receiving object/array props that are recreated on each render

**Status:** Not fixed (needs profiling to identify actual re-render hotspots)

---

### LOW: Large page components doing client-side data fetching

**Files:** Multiple `page.tsx` files (700+ lines) are `'use client'` components that fetch data in `useEffect`. This pattern:

- Blocks rendering until data arrives (no streaming)
- Prevents server-side caching
- Increases bundle size

The settings page already uses `dynamic()` imports for tabs (good pattern). The agents page does too.

**Recommendation:** Gradually migrate to server components with Suspense boundaries for data fetching. The existing Suspense usage is mostly wrapping `useSearchParams`, not data loading.

**Status:** Not fixed (architectural change)

---

## 5. Font Loading

### LOW: Font loading is well-configured

Fonts use `font-display: swap` correctly. The layout includes:

- `<link rel="preconnect" href="https://api.fontshare.com" crossOrigin="anonymous" />`
- Google Fonts loaded via `next/font` with `display: 'swap'` and `subsets: ['latin']`
- Inter and JetBrains Mono load from Fontsource packages with `font-display: swap`

**No issues found.** The font loading strategy is solid.

---

## 6. API Response Times

### MEDIUM: Several API routes lack Cache-Control headers

Many routes set `Cache-Control` headers (good), but several high-traffic routes don't:

- Task CRUD routes (`/api/tasks/[id]`)
- Project CRUD routes (`/api/projects/[id]`)
- Knowledge source routes

**Recommendation:** Use the existing `cachedJson()` helper from `api-cache.ts` for read endpoints. Even a 5-10 second cache reduces load significantly for rapid navigation.

**Status:** Not fixed

---

### MEDIUM: In-memory rate limiter doesn't scale horizontally

**File:** `apps/platform/src/middleware.ts`

The global rate limiter uses an in-memory `Map`. In a multi-instance deployment (Vercel serverless, multiple containers), each instance has its own map, making the rate limit effectively `limit * instance_count`.

**Recommendation:** For now this is acceptable as a baseline. For production scale, move to Redis or Upstash rate limiting. The per-route `applyRateLimit` in `rate-limiter.ts` has the same limitation.

**Status:** Not fixed (acceptable for current scale)

---

## 7. Memory Leaks

### MEDIUM: Realtime subscriptions properly cleaned up

Checked all Supabase realtime channel subscriptions. They all properly call `supabase.removeChannel(channel)` in the useEffect cleanup:

- `projects/page.tsx` -- cleanup on unmount
- `projects/[id]/page.tsx` -- cleanup on unmount

**No issues found** with subscription cleanup.

---

### LOW: Polling intervals properly managed

The document-list component uses `setTimeout` chains (not `setInterval`) with proper cleanup via `clearTimeout`. It also implements:

- Exponential backoff (`nextPollInterval`)
- Maximum duration check (`shouldContinuePolling`)

**No issues found** with interval management.

---

### LOW: Event listeners properly cleaned up

Checked `addEventListener` usage across components. All instances (scroll handlers, click-outside handlers) return cleanup functions in their `useEffect` hooks.

**No issues found** with event listener cleanup.

---

## 8. Caching Strategy

### MEDIUM: No React Query deduplication for shared data

**File:** `apps/platform/src/providers/query-provider.tsx`

React Query is configured with sensible defaults:

```
staleTime: 30_000  (30s)
gcTime: 5 * 60_000 (5min)
```

However, only `use-tasks-query.ts` and `use-projects-query.ts` use React Query hooks. Most data fetching still uses raw `useEffect` + `fetch` patterns, missing out on:

- Request deduplication
- Background refetching
- Optimistic updates
- Stale-while-revalidate

**Recommendation:** Migrate high-traffic data fetching to React Query hooks. Priority:

1. Agent configs (fetched on every workspace page)
2. Workspace settings
3. Analytics dashboards

**Status:** Not fixed (incremental migration)

---

### LOW: Good use of dynamic imports for heavy components

Settings page uses `next/dynamic` for 11 tab components. Agent page uses it for the health dashboard. ReactMarkdown is lazy-loaded in 3 places. This is a good pattern that should be extended.

---

## Quick Wins (safe to implement now)

| #   | Finding                                                     | Severity | Effort | Files                                                   |
| --- | ----------------------------------------------------------- | -------- | ------ | ------------------------------------------------------- |
| 1   | Add `server-only` import to AI SDK usage files              | High     | 5 min  | chat-providers/, lib/execution/                         |
| 2   | Replace `select('*')` with explicit columns in agent-loader | High     | 15 min | lib/agent-loader.ts                                     |
| 3   | Add `.limit()` to cost/summary route                        | Medium   | 2 min  | api/analytics/cost/summary/route.ts                     |
| 4   | Use `cachedJson()` for task/project GET routes              | Medium   | 10 min | api/tasks/, api/projects/                               |
| 5   | Replace `<img>` with `next/image` for avatar components     | High     | 20 min | agent-avatar.tsx, avatar-picker.tsx, support-widget.tsx |

## Architecture Recommendations (future sprints)

1. **Middleware permission caching** -- LRU cache with 30s TTL, biggest single improvement
2. **Usage analytics RPC** -- Move 10K-row aggregation to database
3. **React Query migration** -- Adopt for all workspace-level data fetching
4. **Server component migration** -- Gradual shift for data-heavy pages
5. **Agent loader query consolidation** -- Single RPC replacing waterfall

---

_Generated by RICK performance audit, 2026-04-24_
