# Contributing to Celune

Thanks for helping. This guide covers setup, the checks your change must pass, and how a pull request gets merged.

## Before you start

- For a bug, open an issue with steps to reproduce, or send a fix directly.
- For a feature or a change to a public API (`@celuneai/*` packages, REST routes, MCP tools, the database schema), open an issue first so we can agree on the approach before you write code.
- Report security problems privately, as described in `SECURITY.md`.

## Setup

Requirements: Node.js 20 or later (22 recommended), pnpm 10 (`corepack enable`), and `psql` if you want a local database.

```bash
git clone https://github.com/celune-ai/celune.git
cd celune
pnpm install
pnpm dev          # web app at http://localhost:3002
```

To run against a database, follow `SETUP.md` (Supabase project or Docker Compose).

## Repository layout

| Path             | What it is                                                         |
| ---------------- | ------------------------------------------------------------------ |
| `apps/platform`  | Next.js web app                                                    |
| `apps/api`       | Standalone REST and MCP server                                     |
| `packages/core`  | `@celuneai/core`, domain services behind Store and Gate interfaces |
| `packages/api`   | `@celuneai/api`, HTTP handlers and the MCP server                  |
| `packages/react` | `@celuneai/react`, embeddable UI                                   |
| `packages/cli`   | `@celuneai/cli`                                                    |
| `packages/db`    | Schema, migrations, Supabase clients, scripts                      |
| `ee/`            | Celune Cloud code under a separate commercial license              |

## Checks

CI runs these on every pull request. Run them locally first:

```bash
pnpm type-check
pnpm lint          # ESLint plus the open-core boundary check
pnpm test
pnpm format:check  # pnpm format fixes formatting
pnpm build:packages
```

CI also scans for secrets with gitleaks. Never commit `.env` files, keys, or tokens.

A pull request can merge only when every required check passes: `Type-check, lint, format`, `Test`, `Build`, `Packages on Node 20`, `Schema boot (fresh install)`, `Tenant isolation (real Supabase)`, `Secret scan`, and `Contributor License Agreement`.

## Making changes

- **Tests.** Add or update tests next to the code you change. Bug fixes need a test that fails without the fix.
- **Database.** Add a new file under `packages/db/schema/migrations/`. Do not edit a migration that has shipped. Scope every query to a workspace or organization.
- **Open core.** Code outside `ee/` must not import `@celuneai/ee-*`, name Celune's domains, or hardcode the API key prefix. `scripts/check-open-core.sh` explains the rules.
- **Published packages.** If you change `@celuneai/core`, `@celuneai/api`, `@celuneai/react`, or `@celuneai/cli`, run `pnpm changeset` and commit the file it creates. Maintainers release through a "Version Packages" pull request; see `PUBLISHING.md`.
- **Shared internal packages.** `packages/config`, `packages/db`, `packages/types`, and `packages/ui` are also used by Celune Cloud's private admin app. Keep their exports backward compatible, or call out the break in your pull request.
- **Commits.** Use short, imperative subjects with a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`). Keep unrelated changes in separate pull requests.

## Pull requests

1. Fork the repository and branch from `main`.
2. Make the change and run the checks above.
3. Open a pull request against `main` and fill in the template.
4. Sign the Contributor License Agreement when the CLA bot asks (see below).
5. A code owner (`.github/CODEOWNERS`) reviews. Expect questions; small, focused pull requests merge faster.
6. Once the required checks pass and the review is done, a maintainer squash-merges it.

## Contributor License Agreement

Before we can merge your first pull request, you sign the Celune CLA in `CLA.md` by replying to the bot's comment on the pull request. It is based on the Apache individual and corporate CLAs. You keep the copyright to your work; the CLA grants Celune a license to use and relicense it, which Celune needs because files under `ee/` are distributed under a commercial license. If you contribute for an employer, the employer signs the entity agreement in `CLA.md`.

## Licensing

Files outside `ee/` are licensed under Apache-2.0 (`LICENSE`). Files under `ee/` are licensed under the Celune Enterprise License (`ee/LICENSE`).

## Code of conduct

Everyone taking part in this project follows `CODE_OF_CONDUCT.md`.
