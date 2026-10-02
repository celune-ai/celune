---
name: git-deploy
description: 'Deploy to Vercel via git push with build verification and rollback support.'
user_invocable: true
requires:
  bins: [git, gh]
---

# /git-deploy — Full Deploy Pipeline

The ONLY way to deploy to production. Creates a PR, validates all checks pass, and merges to main (which triggers Vercel auto-deploy). No direct pushes to main — ever.

## Arguments

`/git-deploy [options]`

- `/git-deploy` — full pipeline: branch → PR → checks → merge → deploy
- `/git-deploy status` — check status of current PR and Vercel deployment

---

## On Invocation

### Step 1: Pre-flight local checks

Run checks locally first to catch issues before CI:

```bash
cd $CELUNE_REPO

# 1. Type check
pnpm type-check

# 2. Tests
pnpm test

# 3. Lint
pnpm lint 2>/dev/null || echo "No lint script"
```

**If any check fails**: Stop immediately. Diagnose the issue.

- If it's a quick fix (type error, lint issue), fix it automatically and re-run.
- If it requires the user's attention, report the failure with details and ask what to do.
- Do NOT proceed to push broken code.

### Step 2: Handle uncommitted changes

```bash
git status --short
```

If there are uncommitted changes:

1. Show the diff summary
2. Create a commit with a descriptive message (Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>)
3. Use `{COMMIT_AUTHOR_EMAIL}` as commit author email (Vercel requirement)

### Step 2b: Merged-branch check

Before proceeding, verify the current branch hasn't already been merged:

```bash
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  MERGED_PR=$(gh pr list --head "$BRANCH" --state merged --json number --jq '.[0].number' 2>/dev/null)
  if [ -n "$MERGED_PR" ]; then
    echo "⚠️  Branch '$BRANCH' was already merged via PR #$MERGED_PR."
    echo "    Cannot deploy from a merged branch — create a new branch from origin/main."
    echo "    Use: /git-branch"
    exit 1
  fi
fi
```

### Step 3: Ensure feature branch exists

```bash
BRANCH=$(git branch --show-current)
```

If on `main`:

1. Generate a branch name from recent commits (e.g., `deploy/2026-03-08-ui-polish`)
2. Create the branch: `git checkout -b {branch-name}`

If already on a feature branch, use it.

### Step 4: Push branch & create/update PR

```bash
git push -u origin {branch-name}
```

Check for existing PR:

```bash
gh pr list --head {branch-name} --json number,title,url --jq '.[0]'
```

- **If PR exists**: Update it (commits are already pushed).
- **If no PR**: Create one:

```bash
gh pr create --title "{descriptive title}" --body "$(cat <<'EOF'
## Summary
{bullet points summarizing all changes since diverging from main}

## Checks
- [x] Type check passes locally
- [x] Tests pass locally
- [x] Lint passes locally

## Deploy
Merging this PR deploys to production via Vercel.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Step 5: Wait for CI checks

Poll the PR checks until they complete:

```bash
gh pr checks {pr-number} --watch
```

**If checks fail**:

1. Read the failure details: `gh pr checks {pr-number}`
2. If fixable (type error, test failure): fix locally, commit, push, re-check
3. If unclear or needs the user: report the failure and ask what to do
4. Do NOT merge with failing checks

**If checks pass**: Proceed to merge.

### Step 6: Auto-approve and merge

RICK auto-approves the PR after confirming:

1. All CI checks (Type Check, Tests, Lint) are green
2. No merge conflicts with main
3. Branch is up to date with main

```bash
# Approve the PR
gh pr review {pr-number} --approve --body "All CI checks pass. Auto-approved by RICK."

# Merge with squash (clean history)
gh pr merge {pr-number} --squash --delete-branch
```

### Step 7: Verify deployment

```bash
# Confirm merge landed on main
git checkout main
git pull origin main

# Check Vercel deployment
gh api repos/celune-ai/celune/deployments --jq '.[0] | {environment, state: .statuses_url, created_at, sha: .sha[0:7]}'
```

### Step 7b: Verify Vercel used correct install command

After the GitHub integration triggers, check the Vercel deployment is healthy. If the deploy errors (e.g. production overrides diverged from project settings), force a clean redeploy:

```bash
# Wait ~30s for Vercel to pick up the push, then check latest deployment state
npx vercel inspect --scope celune 2>&1 | tail -5

# If the deploy is in ERROR state or install command was wrong, force redeploy with correct settings
npx vercel deploy --prod
```

**Why this matters**: Vercel "Production Overrides" can get stuck showing stale settings from a previous failed deploy. The project settings (Install Command: `pnpm install --frozen-lockfile`) are correct, but a failed production deploy can lock in empty/wrong overrides that are read-only in the UI. A `vercel deploy --prod` forces a fresh deploy using current project settings, which clears the discrepancy.

Only run the `vercel deploy --prod` fallback if the GitHub-triggered deploy fails or errors. If the deploy succeeds normally, skip this step.

### Step 8: Report

> Deployed to production.
>
> - PR: #{number} — {title}
> - Merged: {sha} → main
> - Checks: Type Check ✓ | Tests ✓ | Lint ✓
> - Vercel: auto-deploying via GitHub integration
> - Dashboard: https://vercel.com/<team>

---

## Status Check (`/git-deploy status`)

For checking current state without deploying:

```bash
# Current PR status
gh pr list --author @me --json number,title,state,statusCheckRollup --jq '.[] | {number, title, state, checks: [.statusCheckRollup[].conclusion]}'

# Latest Vercel deployment
gh api repos/celune-ai/celune/deployments --jq '.[0] | {environment, created_at, sha: .sha[0:7]}'
```

---

## Guard Rails

- **NEVER** push directly to `main` — always go through a PR
- **NEVER** merge with failing CI checks (unless the user explicitly overrides)
- **NEVER** force push
- **NEVER** merge without all 3 checks passing (Type Check, Tests, Lint)
- **NEVER** push secrets, `.env` files, or credentials
- If there are merge conflicts, stop and report — do not auto-resolve
- Use `{COMMIT_AUTHOR_EMAIL}` for commit author email
- If the user says "just push it" or "skip checks", warn them that branch protection rules will block it anyway, then offer `/git-deploy` as the correct path

---

## Blocker Escalation

When a blocker is found (failing check, merge conflict, etc.):

1. **Quick fix** (< 2 min, obvious): Fix it automatically, re-push, continue
2. **Needs the user**: Surface the blocker clearly:
   > ⚠️ Deploy blocked: {reason}
   >
   > - Details: {error output}
   > - Suggested fix: {if known}
   > - Action needed: {what the user should do}
