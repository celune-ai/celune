---
name: git-branch
description: 'Create or switch git branches with workspace naming conventions.'
user_invocable: true
requires:
  bins: [git]
---

# /git-branch — Create a New Branch

Creates a new Git branch after confirming the branch point with the user. Prevents accidental branching from the wrong base.

## Arguments

`/git-branch [branch-name] [--from <base>]`

- `/git-branch` — interactive: shows current state, asks for name and confirms base
- `/git-branch my-feature` — create branch with that name from current HEAD
- `/git-branch my-feature --from main` — create branch from a specific base

---

## On Invocation

### Step 1: Assess current state

```bash
cd $CELUNE_REPO

# Current branch and commit
CURRENT=$(git branch --show-current)
HEAD_COMMIT=$(git log --oneline -1)

# Show recent commits for context
git log --oneline -5

# Check for uncommitted changes
git status --short
```

Present to the user:

```
Current branch: {CURRENT}
Latest commit:  {HEAD_COMMIT}

Recent commits:
  {last 5 commits}

Uncommitted changes: {count or "none"}
```

### Step 2: Determine base branch

**CRITICAL — Merged-branch check (run FIRST, before anything else):**

Before using any branch as a base, check if it has already been merged to main:

```bash
# Check if the candidate base branch has a merged PR
CANDIDATE_BASE="${FROM_ARG:-$CURRENT}"
if [ "$CANDIDATE_BASE" != "main" ] && [ "$CANDIDATE_BASE" != "origin/main" ]; then
  MERGED_PR=$(gh pr list --head "$CANDIDATE_BASE" --state merged --json number --jq '.[0].number' 2>/dev/null)
  if [ -n "$MERGED_PR" ]; then
    echo "⚠️  Branch '$CANDIDATE_BASE' was already merged to main via PR #$MERGED_PR."
    echo "    Branching from it would carry duplicate commits and cause merge conflicts."
    echo "    Forcing base to origin/main instead."
    CANDIDATE_BASE="origin/main"
  fi
fi
```

If the candidate base is merged, **always fall back to `origin/main`**. Do not ask — this is a hard rule. Present to the user:

> ⚠️ `{original_base}` was already merged (PR #{number}). Using `origin/main` as the base instead to avoid duplicate commits.

**If `--from` was specified**: Verify it exists and run the merged-branch check above.

**If on a feature branch**: Ask the user:

> You're on `{CURRENT}`. Branch from here, or from `main`?
>
> 1. From here (`{CURRENT}` @ `{short_sha}`)
> 2. From `main` (@ `{main_short_sha}`)

(But if option 1 fails the merged-branch check, silently use `main` and explain why.)

**If on `main`**: Use `main` as the base automatically. Confirm:

> Creating branch from `main` (@ `{short_sha}`). Correct?

### Step 3: Handle uncommitted changes

If there are uncommitted changes:

1. Show the summary
2. Ask: "You have uncommitted changes. What should we do?"
   - **Commit first** — create a commit on the current branch before branching
   - **Carry them over** — switch to the new branch with changes intact
   - **Stash them** — stash changes, create branch, then you can pop later

### Step 4: Determine branch name

**If a name was provided**: Use it directly.

**If no name provided**: Ask the user for a branch name. Suggest a name based on context:

```
Suggested: celune/rick/{slugified-description}
Branch name:
```

**Naming convention**: `celune/rick/{feature-slug}` for feature work. Keep it lowercase, hyphens, under 50 chars.

### Step 5: Create the branch

```bash
# If base is different from current branch, checkout base first
git checkout {base} 2>/dev/null

# Create and switch to new branch
git checkout -b {branch-name}
```

### Step 6: Report

> Created branch `{branch-name}` from `{base}` (@ `{short_sha}`).
>
> You're now on `{branch-name}`. Ready to work.
>
> Tip: Use `/git-push` when ready to push, `/git-deploy` to merge to main.

---

---

## Worktree Lifecycle (for sub-agents)

When sub-agents use `isolation: "worktree"` during `/build`, they create temporary worktrees. These MUST be cleaned up after use. The lifecycle is:

1. **Creation**: Agent tool creates worktree automatically at `.claude/worktrees/{agent-name}/`
2. **Work**: Sub-agent works in the isolated worktree, commits to a temporary branch
3. **Merge back**: After sub-agent completes, the orchestrator (RICK) MUST:

   ```bash
   # From the main working directory:
   WORKTREE_BRANCH="worktree-agent-{name}"

   # Merge the worktree branch into the project branch
   git merge "$WORKTREE_BRANCH" --no-ff -m "merge: {agent-name} worktree — {task-title}"

   # Remove the worktree
   git worktree remove ".claude/worktrees/{agent-name}" 2>/dev/null

   # Delete the temporary branch
   git branch -d "$WORKTREE_BRANCH" 2>/dev/null
   ```

4. **Verify cleanup**: After all sprint worktrees are merged:

   ```bash
   # List remaining worktrees — should only show the main working directory
   git worktree list

   # Prune any stale worktree references
   git worktree prune

   # Check for dangling worktree branches
   git branch | grep "worktree-" && echo "WARNING: Stale worktree branches found — clean up!"
   ```

**NEVER leave worktrees or worktree branches around between sprints.** Stale worktrees cause:

- "dirty worktree" errors on subsequent operations
- Branch conflicts when creating new worktrees
- Disk space waste from duplicate repo copies
- Confusion about which branch has the latest code

---

## Guard Rails

- **ALWAYS confirm the base** before creating — the whole point of this skill is preventing wrong-base branches
- **NEVER branch from a merged branch** — always check `gh pr list --head <branch> --state merged` first. If merged, use `origin/main`.
- **NEVER delete existing branches** — this skill only creates
- If the branch name already exists, warn and ask if they want to switch to it instead
- If there are uncommitted changes, handle them explicitly — don't silently carry or lose them
- Validate branch name: no spaces, no special chars beyond `/` and `-`
- **Clean up worktrees immediately** after merging — never let them persist across sprints or sessions
