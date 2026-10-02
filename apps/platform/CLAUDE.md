# Platform App (Customer Product)

**Port:** 3002 | **Framework:** Next.js 16 + React 19

## Tech Stack

- UI: @repo/ui (shadcn/ui + Radix UI + Tailwind v4 + CVA)
- DB: Supabase (tasks, projects, activity_log, agent_configs, agent_status, cron_jobs) via @repo/db
- Memory search: Supabase FTS (tsvector) on agent_memory table, with optional vector (semantic) search
- Types: @repo/types (shared Task, Agent types)
- Icons: lucide-react
- Drag-and-drop: @dnd-kit

## Conventions

- Path alias: `@/*` maps to `./src/*`
- API routes use `createServiceClient()` (service role key, bypasses RLS). Never expose service key to browser.
- Use `fetchJson<T>()` helper for all client-side API calls (throws on non-2xx before parsing).
- Design tokens from `packages/ui/src/theme.css`. No hardcoded zinc-\* or color values.
- Dark-first design (`.dark` class on `<html>`).
- **Task titles: 70 character max.** All AI-generated task titles must be ≤70 characters. Prefer concise, imperative phrasing. Move detail to description.

## Commit Protocol

- **Before every commit**: run `git diff --staged` and verify the changeset contains only intended changes.
- **Broad-scope commits** (20+ files or 2+ apps/packages): the pre-commit hook warns automatically. Review the file list before proceeding.
- **Search-replace operations**: always verify the diff after running. Never blindly commit broad regex replacements.
- **Pre-commit hooks** (`.githooks/pre-commit`): secret scanner + internal reference grep gate. Do not bypass with `--no-verify` unless explicitly told to.

## API Security Checklist

Every API route that accepts `workspace_id` or `org_id` MUST:

1. Verify the authenticated user is a member of that workspace/org before any data access
2. Return 401/403 on auth/membership failure — never a silent empty result
3. Use the user's ID from the authenticated session, not from request body

Every PostgreSQL function with `SECURITY DEFINER` MUST:

1. Include a `user_id` filter predicate — no cross-user data access
2. Be reviewed by SCAN before merge
3. Have a comment explaining why SECURITY DEFINER is needed

## Gotchas

- `better-sqlite3` must be in `serverExternalPackages` in next.config or it fails at build.
- `transpilePackages` must include `@repo/ui`, `@repo/types`, `@repo/db`.
- Kanban column labels differ from DB status: `assigned` displays as "Scoping", `planning` displays as "Planned".
- SSE streaming for agent chat: validate data shape before rendering.
