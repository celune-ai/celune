# Publishing Celune

The one-time steps to publish this repository as `celune-ai/celune` and the `@celuneai/*` packages to npm. Run them in order. The admin app and internal notes stay in this private repository; step 1 leaves the paths in `scripts/public-tree-exclude.txt` out of the public tree.

Before you start:

- `celune-ai/celune` exists on GitHub, is **public**, and is empty (no README, license, or .gitignore).
- `npm whoami` prints an account with write access to the `@celuneai` scope (the `celuneai` npm org). `@celuneai/cli` is currently maintained by the `celune` npm user.
- `gh auth status` shows an account that can push to `celune-ai/celune` and set its secrets.
- You have Node.js 22, pnpm 10 (`corepack enable`), and `psql`.

Set these once for the shell session:

```bash
export PLATFORM=~/Documents/GitHub/celune-platform       # the private monorepo checkout
export BRANCH=celune/rick/oss-s3a-publish                 # or main, once this branch is merged
export PUBLIC=/tmp/celune-public
export ADMIN_SRC=/private/tmp/celune-oss/publish-admin    # prepared standalone admin repo
```

## 1. Build the public tree as a single commit

The public repository starts with one commit that contains this branch's tree. The private history stays private, and `git archive` skips every path listed in `scripts/public-tree-exclude.txt` (the admin app, `.claude/`, `memory/`, and internal docs). The list uses pathspecs instead of `.gitattributes` `export-ignore` because Railway builds from GitHub archives, which honor `export-ignore`.

```bash
git -C "$PLATFORM" fetch origin "$BRANCH"
rm -rf "$PUBLIC" && mkdir -p "$PUBLIC"
EXCLUDES=$(git -C "$PLATFORM" show "origin/$BRANCH:scripts/public-tree-exclude.txt" | grep -v '^#' | sed 's/^/:(exclude,top)/')
git -C "$PLATFORM" archive "origin/$BRANCH" -- . $EXCLUDES | tar -x -C "$PUBLIC"
cd "$PUBLIC"
git init -b main
git add -A
git commit -m "Initial public release"
```

## 2. Check the tree before it leaves your machine

All of these must print nothing, except the gitleaks line, which must say `no leaks found`, and the public tree check, which must say `Public tree check passed.` Set `HOSTED_REF` to the Celune Cloud Supabase project ref (Supabase dashboard, Project Settings) so the ref itself never appears in this file.

```bash
cd "$PUBLIC"
export HOSTED_REF=<hosted project ref>
gitleaks git . --config .gitleaks.toml --redact --no-banner
bash "$PLATFORM/scripts/check-public-tree.sh" "$PUBLIC"   # prints "Public tree check passed."
git grep -niE 's(ö|oe?)hne|circular ?std'
git grep -n "$HOSTED_REF"
git grep -nE 'admin\.celune\.ai|celune\.(io|app)([^a-z]|$)|smejkaldesign[/]'
git grep -n 'npx cel''une '
git grep -nE '/Users/[a-z]+/' -- ':!apps/platform/src/lib/guardrails/__tests__' ':!PUBLISHING.md'
git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '\.example$'
git ls-files | grep -E '^apps/admin/'
```

The guardrails tests contain fake home paths on purpose; they test path redaction.

Then read the email addresses the tree contains. Each one must be a placeholder, a public project address, or a `# ref-ok` line in `scripts/check-internal-refs.sh`. Add any personal address's file to `scripts/public-tree-exclude.txt`, or remove the address, and rebuild the tree:

```bash
git grep -hoIE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}' | sort -u | grep -viE '@(celune\.ai|example\.[a-z]+|company\.com|test\.com|users\.noreply\.github\.com|anthropic\.com|github\.com)$'
```

Install gitleaks with `brew install gitleaks` if it is missing.

Then run the checks CI runs:

```bash
pnpm install --frozen-lockfile
pnpm type-check && pnpm lint && pnpm test && pnpm format:check
pnpm build:packages && pnpm -r --filter './packages/*' pack --dry-run
```

## 3. Push the public repository

```bash
cd "$PUBLIC"
git remote add origin git@github.com:celune-ai/celune.git
git push -u origin main

# Branch the CLA workflow writes signatures to
git switch --orphan cla-signatures
git commit --allow-empty -m "CLA signatures"
git push -u origin cla-signatures
git switch main
```

## 4. Configure the GitHub repository

```bash
# Let the changesets workflow open "Version Packages" pull requests
gh api -X PUT repos/celune-ai/celune/actions/permissions/workflow \
  -f default_workflow_permissions=write -F can_approve_pull_request_reviews=true

# Private vulnerability reporting, which SECURITY.md points to
gh api -X PUT repos/celune-ai/celune/private-vulnerability-reporting
```

`release.yml` publishes with npm trusted publishing (step 6), so the repository needs no `NPM_TOKEN` secret. Set one only as a fallback while trusted publishing is not configured yet, or if it ever stops working; paste an npm automation token at the hidden prompt:

```bash
gh secret set NPM_TOKEN --repo celune-ai/celune
```

In the GitHub UI, protect `main`: require pull requests and the `Type-check, lint, format`, `Test`, `Build`, `Packages on Node 20`, `Secret scan`, and `Contributor License Agreement` checks.

## 5. Publish the packages to npm

The first publish runs from your machine so you can watch it. `changeset publish` publishes every package whose version is not on npm yet: `@celuneai/core@0.1.0`, `@celuneai/api@0.1.0`, `@celuneai/react@0.1.0`, and `@celuneai/cli@1.1.0`. Private packages are skipped.

The tree also carries the pending changesets in `.changeset/`. `changeset publish` ignores them; after this step, the public repository's `release.yml` opens the first "Version Packages" pull request from them. The private `celune-platform` repository never versions or publishes: `release.yml` runs only in `celune-ai/celune`.

```bash
cd "$PUBLIC"
pnpm build:packages
pnpm changeset publish            # add --otp=<code> if your npm account uses 2FA
git push --follow-tags
```

Check the result:

```bash
npm view @celuneai/core version
npm view @celuneai/api version
npm view @celuneai/react version
npm view @celuneai/cli version
npx -y @celuneai/cli@1.1.0 --version
```

The packages must exist on npm before step 6, because npm configures trusted publishing per package.

## 6. Configure npm trusted publishing

`release.yml` authenticates to npm with a short-lived token that npm issues to that workflow through OpenID Connect (OIDC). npm attaches a provenance attestation to every package it publishes this way. Do this once for each of `@celuneai/core`, `@celuneai/api`, `@celuneai/react`, and `@celuneai/cli`:

1. On npmjs.com, open the package, then **Settings**, then the **Trusted Publisher** section.
2. Under **Select your publisher**, click **GitHub Actions** and fill in the fields exactly. They are case-sensitive.

   | Field                | Value                                                        |
   | -------------------- | ------------------------------------------------------------ |
   | Organization or user | `celune-ai`                                                  |
   | Repository           | `celune`                                                     |
   | Workflow filename    | `release.yml` (the file name only, with the extension)       |
   | Environment name     | leave empty; `release.yml` does not use a GitHub environment |
   | Allowed actions      | allow `npm publish`; `changeset publish` publishes directly  |

3. Save. A connection cannot be edited later; to change a field, delete it and add a new one.

Then lock token publishing out, per package:

4. **Settings**, then **Publishing access**, select **Require two-factor authentication and disallow tokens**, and click **Update Package Settings**. Trusted publishing keeps working because it does not use a token.
5. If you set the `NPM_TOKEN` fallback secret in step 4, delete it and revoke the token on npmjs.com:

```bash
gh secret delete NPM_TOKEN --repo celune-ai/celune
```

From now on, merge pull requests with changesets into `main`. `release.yml` opens a "Version Packages" pull request, and merging it publishes through trusted publishing. Check that the next release shows a provenance badge on each package page on npmjs.com.

Requirements `release.yml` already meets: a GitHub-hosted runner, `id-token: write`, npm 11.5.1 or later (Node 24; a workflow step fails the run on an older npm), and a `repository` field in each package's `package.json` that matches `celune-ai/celune`. If a publish fails with `ENEEDAUTH`, compare the workflow filename on npmjs.com with the file in `.github/workflows/`. A new `@celuneai/*` package needs its first publish from your machine (step 5) and then its own trusted publisher.

## 7. Optional: move the admin app to its own repository

The admin app keeps building from `apps/admin` in this repository. To split it out later instead:

```bash
cd "$ADMIN_SRC"
git log --oneline             # the initial commit plus vendor syncs
gitleaks git . --redact --no-banner
git remote add origin git@github.com:celune-ai/celune-admin.git
git push -u origin main
```

Move the admin app's deployment (Vercel project or Railway service) to the new repository and set its root directory to `/`.

## 8. After publishing

- Confirm `hello@celune.ai` receives mail. It is the only inbox the public files name (security, conduct, CLA, and sales mail all go there, tagged in the subject); no other mailboxes are needed.
- Replace "Celune" as the copyright holder in `LICENSE` headers, `NOTICE`, `ee/LICENSE`, and `CLA.md` if the legal entity has a different name. Have counsel review `ee/LICENSE` and `CLA.md`.
- Celune Cloud database migrations run from this repository through the approval-gated workflow in section 9.
- The hosted database recorded the original hashes of `002-security-fixes.sql`, `003-agent-configs.sql`, and `004-agent-permissions.sql`. Only comments changed in those files, so `pnpm migrate` and the production runner print hash-mismatch warnings for them and apply nothing.

## 9. Production migrations (Celune Cloud)

Celune Cloud migrations run from `.github/workflows/migrate-production.yml`. It starts only by hand (**Actions**, then **Migrate production**, then **Run workflow** on `main`), runs in the `production` environment, and waits for an approving reviewer before it can read the database secret. Pull requests and forks cannot start it.

One-time setup, in **Settings**, then **Environments**, then **production**:

1. Deployment branches: `main` only.
2. Required reviewers: the account that approves production changes.
3. Environment secret `DATABASE_URL`: the Supabase **Session pooler** connection string (Project Settings, then Database, then Connection string, then Session pooler; port 5432). GitHub runners have no IPv6, which the direct `db.<ref>.supabase.co` host needs, and the transaction pooler on port 6543 does not keep the session state DDL needs. Store it on the environment only, never as a repository secret.

For each release with new files in `packages/db/schema/migrations/`:

1. Merge the migration pull request.
2. Run **Migrate production** with mode `plan`, approve it, and read the list of pending files and any hash-mismatch warnings. Nothing changes in plan mode.
3. Run it again with mode `apply` and approve it.

`packages/db/scripts/migrate-production.mjs` is stricter than `pnpm migrate`: any SQL error stops the run, each file and its `public._migrations` row commit in one transaction (a failed file is rolled back and later files are not attempted), and `ALTER TYPE ... ADD VALUE IF NOT EXISTS` statements commit first on their own because Postgres cannot use a new enum value in the transaction that added it. Enum additions must use `IF NOT EXISTS`. The runner never creates helper functions and refuses to run against a database without `public._migrations`.
