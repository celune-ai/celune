# Database Migrations

SQL migration files for the Celune Supabase database.

## Naming Convention

```
YYYYMMDD_description.sql
```

- **Date prefix**: The date the migration was created (e.g., `20260329`).
- **Description**: Snake-case summary of the change (e.g., `add_workspace_roles`).
- **No spaces or numeric suffixes** in file names. Files like `20260329_foo 2.sql` are duplicates created by macOS and should be deleted.

## Creating a Migration

1. Create a new `.sql` file following the naming convention above.
2. Write idempotent SQL where possible (`IF NOT EXISTS`, `OR REPLACE`).
3. Include a comment at the top describing what the migration does.
4. Test locally before committing.

Example:

```sql
-- Add feature_flags.screenshots column for storing flag screenshot URLs
ALTER TABLE feature_flags
  ADD COLUMN IF NOT EXISTS screenshots jsonb DEFAULT '[]'::jsonb;
```

## Testing Migrations Locally

Before merging, verify your migration against a local or staging database:

**Local stack (recommended).** The repo has no `supabase/` directory, so `supabase db reset` applies nothing from here. Boot the Docker self-host database instead, the same way the CI `schema` job does:

```bash
npx @celuneai/cli init --mode docker                      # writes docker/.env
docker compose -f docker/docker-compose.yml up -d --wait db auth storage
docker compose -f docker/docker-compose.yml run --rm migrate   # baseline, then newer files
docker compose -f docker/docker-compose.yml run --rm migrate   # must print "applied 0 migrations"
```

A new migration sorts after the baseline, so the first run applies it on top of the baseline. To test the whole incremental chain instead, start from an empty volume and skip the baseline:

```bash
docker compose -f docker/docker-compose.yml down -v
docker compose -f docker/docker-compose.yml up -d --wait db auth storage
docker compose -f docker/docker-compose.yml run --rm -e BOOT_BASELINE=0 migrate
```

Any empty Supabase database works the same way: `DATABASE_URL=postgresql://... packages/db/scripts/boot-local.sh`.

**Staging database:**

```bash
psql "$STAGING_DATABASE_URL" -f packages/db/schema/migrations/YYYYMMDD_your_migration.sql
```

Verify the migration is idempotent by running it twice. The second run should succeed without errors.

Do not edit a migration file that `baseline/0001_baseline.sql` records. Fresh installs skip recorded files, and `node packages/db/scripts/check-baseline.mjs` (run in CI) fails on the change. Add a new migration instead.

## Applying Migrations (Production)

**Via Supabase MCP (preferred):**

Use the `apply_migration` MCP tool which runs SQL directly against the hosted database.

**Via pnpm:**

```bash
pnpm migrate          # Apply pending migrations
```

**Manual:**

Run the SQL file contents directly in the Supabase SQL Editor or via `psql`.

## Filename Enforcement

There is no automated CI lint for migration filenames yet. Reviewers should verify:

1. Format is `YYYYMMDD_description.sql` (no spaces, no numeric suffixes like `foo 2.sql`)
2. Description is lowercase snake_case
3. No duplicate date+description combinations

The pre-commit hook prints a reminder when migration files are staged, but does not validate naming.

## Legacy vs Modern Naming

Older migrations may use slightly different conventions (e.g., longer descriptions or missing date prefixes). All new migrations must follow the `YYYYMMDD_description.sql` format.

## Schema Reference

The full current schema is captured in `packages/db/schema/supabase-schema.sql`. This file is the source of truth for the table structure and should be kept in sync after migrations are applied.
