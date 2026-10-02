---
name: git-push
description: 'Push commits to remote branch with optional PR creation.'
user_invocable: true
requires:
  bins: [git, gh]
---

# /git-push — Push to Branch & PR

Pushes local commits to a remote branch and optionally creates or updates a pull request.

## Arguments

`/git-push [branch-name]`

- `/git-push` — push current branch; if on `main`, create a feature branch first
- `/git-push my-feature` — push to the specified branch name

---

## On Invocation

### Step 1: Assess current state

```bash
cd $CELUNE_REPO

# Current branch
BRANCH=$(git branch --show-current)

# Uncommitted changes
git status --short

# Commits ahead of origin
git log origin/main..HEAD --oneline 2>/dev/null || echo "No remote tracking"
```

### Step 2: Handle uncommitted changes

If there are uncommitted changes:

1. Show the diff summary to the user
2. Ask: "There are uncommitted changes. Commit these before pushing?"
3. If yes, create a commit with a descriptive message (Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>)
4. If no, stash them and continue

### Step 2b: Merged-branch check

Before pushing, verify the current branch is not based on an already-merged branch:

```bash
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  MERGED_PR=$(gh pr list --head "$BRANCH" --state merged --json number --jq '.[0].number' 2>/dev/null)
  if [ -n "$MERGED_PR" ]; then
    echo "⚠️  This branch ($BRANCH) was already merged via PR #$MERGED_PR."
    echo "    Pushing more commits to it will cause duplicate commit issues."
    echo "    Create a new branch from origin/main instead: /git-branch"
    # STOP — do not push to a merged branch
    exit 1
  fi
fi
```

If the branch is already merged, **stop immediately** and tell the user to create a new branch from `origin/main`.

### Step 2c: Worktree check

If running inside a worktree (sub-agent context), ensure changes are committed before returning control:

```bash
# Detect if we're in a worktree
WORKTREE_DIR=$(git rev-parse --git-common-dir 2>/dev/null)
MAIN_DIR=$(git rev-parse --git-dir 2>/dev/null)

if [ "$WORKTREE_DIR" != "$MAIN_DIR" ]; then
  echo "Running inside a worktree — committing all changes before merge-back."
  git add -A
  git diff --cached --quiet || git commit -m "worktree: finalize changes for merge-back

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
fi
```

### Step 3: Ensure we're on a feature branch

If currently on `main`:

1. If a branch name was provided as argument, use that
2. Otherwise, generate a branch name from the recent commit messages (e.g., `feat/task-table-ui-polish`)
3. Ask the user: "You're on main. Create branch `{name}` and push there? (y/n)"
4. If yes, create and switch to the branch
5. If no, abort — we never push directly to main from this skill

```bash
# Create branch from main
git checkout -b {branch-name}
```

### Step 4: Push to remote

```bash
git push -u origin {branch-name}
```

### Step 5: Check for existing PR

```bash
gh pr list --head {branch-name} --json number,title,url --jq '.[0]'
```

- **If PR exists**: Report the PR URL. Done.
- **If no PR exists**: Ask the user:
  > No PR exists for `{branch-name}`. Would you like to create one? (y/n)

If yes, create the PR:

```bash
gh pr create --title "{title}" --body "$(cat <<'EOF'
## Summary
{bullet points from commits}

## Test plan
- [ ] Type check passes
- [ ] Tests pass
- [ ] Manual QA

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

If no, just report the branch was pushed. They can create a PR later.

### Step 6: Report

> Pushed to `{branch-name}` ({n} commits).
>
> - PR: {url} (or "No PR — branch only")
> - Commits: {list}
> - CI checks will run automatically on the PR.

---

### Step 7: Sync project_prs record

After pushing, ensure the branch is linked in the `project_prs` table:

1. Read `~/.claude/state/active-context.json` for current project context
2. If a project_id is set but no PR exists yet:
   - Check workspace `github_settings.auto_pr`:
     - `"draft_on_push"`: Create a draft PR via `gh pr create --draft`
     - `"ready_on_push"`: Create a ready PR via `gh pr create`
     - `"off"`: Skip PR creation, just push the branch
   - After PR creation, call `POST /api/github/prs` to create the project_prs record
3. If a PR already exists, update the record with the new head SHA
4. Write updated context to `~/.claude/state/active-context.json`

---

## Guard Rails

- **NEVER** push directly to `main` — always use a feature branch
- **NEVER** push to a branch that has already been merged — create a new branch from `origin/main` instead
- **NEVER** force push unless the user explicitly asks
- If the push is rejected (behind remote), pull with rebase first
- Use the git author email configured for this repository
- **Worktree awareness**: If in a worktree, commit all changes before returning control to the orchestrator. The orchestrator is responsible for merge-back and cleanup.
