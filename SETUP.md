# Self-hosting Celune

Self-hosted Celune runs the community edition (`CELUNE_EDITION=community`): no billing, no plan limits, no Stripe, and bring-your-own-key AI. Each workspace adds its own provider keys in Settings > Provider Keys.

`npx @celuneai/cli init` sets everything up (`celune init` if you installed the CLI globally). It writes secrets only to env files (mode 0600) and never prints them. Re-running it keeps every secret that is already set.

## Prerequisites

- Node.js 20 or later
- pnpm 10 (`corepack enable`)
- `psql` 15 or later (`brew install libpq` or `apt install postgresql-client`) for Option A
- Docker with Compose v2 for Option B

## Option A: link an existing Supabase project

From your Supabase project settings, copy the project URL, the anon and service role keys, and a Postgres connection string. The session pooler on port 5432 works.

```bash
git clone https://github.com/celune-ai/celune.git
cd celune
pnpm install

# Pass values through the environment so they stay out of shell history,
# or run without them and answer the prompts (secret input is hidden).
export SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_ANON_KEY=<anon key>
export SUPABASE_SERVICE_ROLE_KEY=<service role key>
export DATABASE_URL=postgresql://postgres.<ref>:<password>@<pooler host>:5432/postgres
npx @celuneai/cli init --mode supabase

pnpm dev                 # web app at http://localhost:3002
pnpm --filter api dev    # API at http://localhost:3010 (REST /v1, MCP /v1/mcp)
```

`init` writes `apps/platform/.env.local` and `apps/api/.env`, then applies the schema with `packages/db/scripts/boot-local.sh`. Add `--skip-migrations` to write env files only.

Always run the CLI as `npx @celuneai/cli`, or as `celune` after `npm install -g @celuneai/cli`. The unscoped `celune` package on npm is unrelated. To run the CLI from this checkout instead, for example to test unreleased changes, use `pnpm --filter @celuneai/cli build` and then `node packages/cli/dist/index.js init`.

## Option B: Docker Compose

The stack runs Supabase (Postgres, Auth, REST, Realtime, Storage, Kong), a one-shot migrate job, the API, and the web app.

```bash
git clone https://github.com/celune-ai/celune.git
cd celune
npx @celuneai/cli init --mode docker   # writes docker/.env with generated secrets
docker compose -f docker/docker-compose.yml up -d --build
```

Then create the first account as described below, open http://localhost:3000, sign in, and create a workspace.

#### First account

Open sign-up is off by default (`DISABLE_SIGNUP=true` in `docker/.env`), so nobody who reaches the stack can create an account on their own. This also applies to new OAuth sign-ins. Create accounts in one of two ways:

- **Studio:** run `docker compose -f docker/docker-compose.yml --profile studio up -d`, open http://localhost:54323, go to Authentication, and add a user with auto confirm on.
- **Auth admin API:** run this from the repo root. It reads the service role key from `docker/.env` and does not print it.

```bash
KEY=$(grep '^SERVICE_ROLE_KEY=' docker/.env | cut -d= -f2-) && curl -s -X POST http://localhost:8000/auth/v1/admin/users -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"email":"you@example.com","password":"choose-a-long-password","email_confirm":true}' > /dev/null && echo created
```

To let a group of trusted people sign up themselves, set `DISABLE_SIGNUP=false`, run `docker compose -f docker/docker-compose.yml up -d auth`, and set it back to `true` the same way when they are done.

| Service | Host port | Notes                                                                    |
| ------- | --------- | ------------------------------------------------------------------------ |
| web     | 3000      | Next.js app, community edition                                           |
| api     | 3010      | `/health`, REST at `/v1`, MCP at `/v1/mcp`                               |
| kong    | 8000      | Supabase gateway (`/auth/v1`, `/rest/v1`, `/realtime/v1`, `/storage/v1`) |
| db      | 54322     | Postgres, bound to 127.0.0.1                                             |
| studio  | 54323     | Only with `docker compose --profile studio up`                           |

Without the CLI, copy `docker/.env.example` to `docker/.env` and follow the generation notes in that file. There is no worker container: server agent runs execute inside the web app, and IDE or CLI agents claim jobs through the API.

### Upgrading: the job HMAC key

Job queue rows are signed with `JOB_HMAC_KEY`. Earlier installs signed them with a subkey of `PROVIDER_KEY_ENCRYPTION_KEY`. Re-run `npx @celuneai/cli init` to add `JOB_HMAC_KEY` to your env files; it keeps every secret that is already set. Restart the web and api services together so both sign and verify with the same key. Jobs signed with the old subkey still verify for one release, so jobs already in the queue finish normally. After that release the old subkey is no longer accepted.

## How the schema is applied

`packages/db/scripts/boot-local.sh` decides what to run:

- **Empty database** (no tables in `public`): it applies `packages/db/schema/baseline/0001_baseline.sql` in one transaction. The baseline is the full schema as of its last regeneration, and it records every migration it covers in `public._migrations`. Any migration file newer than the baseline runs after it.
- **Existing database**: it applies `supabase-schema.sql` once, then every migration file under `packages/db/schema/migrations/` that is not yet recorded in `public._migrations`, in bytewise filename order.

A re-run, or a run after an interruption, applies only what is missing. Set `BOOT_BASELINE=0` to boot an empty database from the incremental files instead.

The script needs the Supabase roles and schemas (`auth`, `storage`, `extensions`), so point it at a Supabase project or the compose stack. A plain Postgres server does not have them.

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres packages/db/scripts/boot-local.sh
```

To regenerate the baseline after adding migrations, boot an empty Supabase database with `BOOT_BASELINE=0`, then run `DATABASE_URL=... node packages/db/scripts/generate-baseline.mjs` (needs `pg_dump` 17).

### Measured schema time

New free Supabase project in us-east-1, reached through the session pooler from a laptop, on 2026-09-27:

| Path                                         | Time  |
| -------------------------------------------- | ----- |
| Baseline on an empty database                | 139 s |
| Incremental files on an empty database (188) | 340 s |
| Re-run with nothing to apply                 | 3 s   |

The time is almost all network round trips to the pooler, one per SQL statement. A local database (Option B) is much faster.

## Choose the edition

`apps/platform/.env.example` sets `CELUNE_EDITION=community`, which runs with no suspension, trial, or plan checks. Keep it for a self-hosted install. `NEXT_PUBLIC_APP_DOMAIN` is blank in the example; set it to your own app host.

On startup the platform server logs one line with the resolved edition and gate mode, for example:

```
[startup] edition=community gate=noop
```

## Task CLI

`packages/db/scripts/task-cli.mjs` reads `apps/platform/.env.local` and manages tasks from the command line:

```bash
node packages/db/scripts/task-cli.mjs list --status inbox
node packages/db/scripts/task-cli.mjs create --title "Build feature X" --assignee rick
node packages/db/scripts/task-cli.mjs claim <task-id> --agent rick
node packages/db/scripts/task-cli.mjs complete <task-id> --agent rick
```

## Customization

- **Agents**: the default roster lives in `apps/platform/src/lib/agents-data.ts` (names, roles, models, personality parameters).
- **Colors**: edit `packages/ui/src/theme.css` for design tokens.
- **CORS**: set `ALLOWED_ORIGINS` and `CORS_ORIGINS` (comma-separated).

## Troubleshooting

| Issue                        | Fix                                                      |
| ---------------------------- | -------------------------------------------------------- |
| `psql was not found`         | Install the PostgreSQL client or use `--skip-migrations` |
| Boot fails on the baseline   | The database is not a Supabase database; see above       |
| Task CLI auth error          | Check `apps/platform/.env.local` has valid Supabase keys |
| CORS blocked                 | Add your domain to `ALLOWED_ORIGINS`                     |
| `better-sqlite3` build error | Add it to `serverExternalPackages` in `next.config.ts`   |
