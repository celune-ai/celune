# Publishing Celune

How Celune ships from this repository: npm releases of the `@celuneai/*` packages, the checks that guard every change, and how Celune Cloud deploys. `celune-ai/celune` is the single source of truth for the product, the published packages, and the Celune Cloud app.

## 1. Release the packages

Releases run through [Changesets](https://github.com/changesets/changesets) and `.github/workflows/release.yml`. That workflow runs only in `celune-ai/celune`.

1. A pull request that changes `@celuneai/core`, `@celuneai/api`, `@celuneai/react`, or `@celuneai/cli` includes a changeset (`pnpm changeset`).
2. When it merges, `release.yml` opens or updates a "Version Packages" pull request that bumps versions and writes changelogs.
3. Merging the "Version Packages" pull request publishes every bumped package to npm.

`release.yml` publishes with npm trusted publishing: npm issues the workflow a short-lived token through OpenID Connect (OIDC) and attaches a provenance attestation to each package. The repository stores no `NPM_TOKEN`. Each package page on npmjs.com shows a provenance badge for releases published this way.

### Trusted publisher settings

All four packages are configured on npmjs.com (package **Settings**, **Trusted Publisher**, **GitHub Actions**) with these values. They are case-sensitive.

| Field                | Value                                                        |
| -------------------- | ------------------------------------------------------------ |
| Organization or user | `celune-ai`                                                  |
| Repository           | `celune`                                                     |
| Workflow filename    | `release.yml` (the file name only, with the extension)       |
| Environment name     | leave empty; `release.yml` does not use a GitHub environment |

**Publishing access** on each package is set to **Require two-factor authentication and disallow tokens**. Trusted publishing keeps working because it does not use a token.

A connection cannot be edited; to change a field, delete it and add a new one. If a publish fails with `ENEEDAUTH`, compare the workflow filename on npmjs.com with the file in `.github/workflows/`.

`release.yml` meets npm's requirements: a GitHub-hosted runner, `id-token: write`, npm 11.5.1 or later (Node 24; a workflow step fails the run on an older npm), and a `repository` field in each package's `package.json` that matches `celune-ai/celune`.

### A new package

npm configures trusted publishing per package, so a new `@celuneai/*` package needs one manual publish first:

```bash
pnpm build:packages
pnpm changeset publish            # add --otp=<code> if your npm account uses 2FA
git push --follow-tags
```

Then add its trusted publisher with the settings above, and set its publishing access to disallow tokens.

## 2. Checks on every change

`main` is protected. A pull request merges only when these checks pass: `Type-check, lint, format`, `Test`, `Build`, `Packages on Node 20`, `Schema boot (fresh install)`, `Tenant isolation (real Supabase)`, `Secret scan`, and `Contributor License Agreement`. Force pushes and branch deletion are blocked.

The quality job runs three repository guards:

| Script                           | What it blocks                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `scripts/check-open-core.sh`     | `@celuneai/ee-*` imports outside `ee/`, hosted domains, the API key prefix, font files |
| `scripts/check-internal-refs.sh` | Internal domains and old commit identities                                             |
| `scripts/check-public-tree.sh`   | Founder-specific names, vault paths, home paths, and chat IDs                          |

The secret scan runs gitleaks with `.gitleaks.toml`. Mark an intentional match in `check-public-tree.sh` with `ref-ok` on the same line.

## 3. Shared packages and the admin app

The Celune Cloud admin app lives in a separate private repository. It builds against a pinned commit of this repository and uses `packages/config`, `packages/db`, `packages/types`, and `packages/ui` from it. A change to those packages reaches the admin app when its pinned commit is bumped, so keep their exports backward compatible or note the break in the pull request.

## 4. Celune Cloud

Celune Cloud runs the web app from this repository's `main` branch.

The hosted database recorded the original hashes of `002-security-fixes.sql`, `003-agent-configs.sql`, and `004-agent-permissions.sql`. Only comments changed in those files, so the migration runners print hash-mismatch warnings for them and apply nothing.

### Production migrations

Celune Cloud migrations run from `.github/workflows/migrate-production.yml`. For how migrations are written, ordered, and tracked, see [Upgrades, Migrations, and Rollback](apps/platform/DEPLOYMENT.md#8-upgrades-migrations-and-rollback); this section covers only the Cloud workflow. It starts only by hand (**Actions**, then **Migrate production**, then **Run workflow** on `main`), runs in the `production` environment, and waits for an approving reviewer before it can read the database secret. Pull requests and forks cannot start it.

One-time setup, in **Settings**, then **Environments**, then **production**:

1. Deployment branches: `main` only.
2. Required reviewers: the account that approves production changes.
3. Environment secret `DATABASE_URL`: the Supabase **Session pooler** connection string (Project Settings, then Database, then Connection string, then Session pooler; port 5432). GitHub runners have no IPv6, which the direct `db.<ref>.supabase.co` host needs, and the transaction pooler on port 6543 does not keep the session state DDL needs. Store it on the environment only, never as a repository secret.

For each release with new files in `packages/db/schema/migrations/`:

1. Merge the migration pull request.
2. Run **Migrate production** with mode `plan`, approve it, and read the list of pending files and any hash-mismatch warnings. Nothing changes in plan mode.
3. Run it again with mode `apply` and approve it.

`packages/db/scripts/migrate-production.mjs` is stricter than `pnpm migrate`: any SQL error stops the run, each file and its `public._migrations` row commit in one transaction (a failed file is rolled back and later files are not attempted), and `ALTER TYPE ... ADD VALUE IF NOT EXISTS` statements commit first on their own because Postgres cannot use a new enum value in the transaction that added it. Enum additions must use `IF NOT EXISTS`; if a later statement in the same file fails, the new enum value stays in the database and the re-run skips it. The runner never creates helper functions and refuses to run against a database without `public._migrations`.

## 5. Project contacts and legal

- `hello@celune.ai` is the only inbox the public files name. Security, conduct, CLA, and sales mail all go there, tagged in the subject.
- The copyright holder in `LICENSE` headers, `NOTICE`, `ee/LICENSE`, and `CLA.md` is "Celune". Replace it if the legal entity has a different name, and have counsel review `ee/LICENSE` and `CLA.md`.

## History

The repository was first published on 2026-10-02 as a single commit built from a private monorepo, with internal notes and the admin app left out. Since then all product work happens here.
