# CLAUDE.md

Guidance for AI coding agents working in this repository. Human contributors should read `CONTRIBUTING.md`.

## Layout

Turborepo with pnpm workspaces and Supabase (PostgreSQL).

```
apps/
  platform/    # Next.js web app (port 3002)
  api/         # Hono server: REST at /v1, MCP at /v1/mcp (port 3010)
packages/
  core/        # @celuneai/core: domain services behind Store and Gate interfaces
  api/         # @celuneai/api: HTTP handlers and MCP server
  react/       # @celuneai/react: embeddable project management UI
  cli/         # @celuneai/cli: run as `npx @celuneai/cli init`, bin name `celune`
  db/          # Supabase clients, queries, schema, migrations, scripts
  types/ ui/ config/ brain/ notifications/ agentmail/ discord-gateway/
ee/            # Celune Cloud code under a separate commercial license
examples/      # Embedding examples
```

## Commands

```bash
pnpm dev             # web app
pnpm build           # build the web app and its dependencies
pnpm type-check
pnpm lint            # includes the open-core boundary check
pnpm test
pnpm format:check
pnpm -r --filter "./packages/*" build   # build the publishable packages
```

## Rules

- Code under `ee/` is imported only from `apps/platform/src/lib/gate.ts`. `scripts/check-open-core.sh` enforces this.
- Brand domains and the API key prefix live in `packages/core/src/config.ts`, `packages/cli/src/defaults.ts`, and `apps/platform/src/lib/host-config.ts`. Do not hardcode them elsewhere.
- Schema changes go in a new file under `packages/db/schema/migrations/`. Never edit an applied migration.
- Scope every query to the active workspace or organization.
- Add a changeset (`pnpm changeset`) for any change to a published package.
- Never commit `.env` files or secrets. CI runs gitleaks.
