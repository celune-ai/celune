# Git Worktrees: Visual Guide for AI Agent Teams

Quick visual reference for understanding and using git worktrees.

---

## How Worktrees Work: The File System

```
NORMAL GIT (branch switching):
==================================
Main directory:
  /repo
  +- .git/         (shared)
  +- src/
  +- docs/
  +- package.json

On main:       On feature:      Problem:
git branch     git stash       ---------------
* main         git checkout    Can't work on both
  feature      feature         simultaneously!
               git pop         Must stash <-> switch


GIT WORKTREES (simultaneous):
==================================
Shared .git:
  /repo/.git
  +- objects/        (all commits, shared)
  +- refs/
  +- worktrees/      (metadata for each)

/repo/                    /repo/.claude/worktrees/writer-prd/
+- .git (file) -----+    +- .git -> ../../.git (symlink)
+- src/              |    +- src/
+- docs/             |    +- docs/
+- package.json      |    +- package.json
                     +--- (same working tree as main)

Both exist simultaneously!
  /repo                 (main branch)
  /worktrees/writer-prd   (writer-prd branch)
  /worktrees/reviewer-types (reviewer-types branch)

No stashing, no switching, no conflicts.
```

---

## Agent Workflow Timeline

```
0:00  Lead agent creates 2 tasks in Supabase
      +-------------------------------------+
      | Task 1: Rewrite auth PRD            |
      | Task 2: Add auth TypeScript types   |
      +-------------------------------------+

0:02  Lead agent spawns 2 agents with isolation: "worktree"
      +- Agent "writer-prd"    (Sonnet, worktree mode)
      +- Agent "reviewer-types"  (Sonnet, worktree mode)

0:05  Agents auto-land in worktrees
      Writer lands in:
      /repo/.claude/worktrees/writer-prd
      Branch: writer-prd

      Reviewer lands in:
      /repo/.claude/worktrees/reviewer-types
      Branch: reviewer-types

0:05-  PARALLEL EXECUTION
0:20   +----------------------+----------------------+
       | Writer (writer-prd)  | Reviewer (rev-types) |
       +----------------------+----------------------+
       | 1. Claim task 1      | 1. Claim task 2      |
       | 2. Edit docs/auth.md | 2. Edit types/auth.ts|
       | 3. git add .         | 3. git add .         |
       | 4. git commit        | 4. git commit        |
       | 5. Complete task 1   | 5. Complete task 2   |
       | 6. Report branch     | 6. Report branch     |
       +----------------------+----------------------+

       Lead agent watches kanban (real-time SSE updates)
       Card 1: Assigned -> In Progress -> Done
       Card 2: Assigned -> In Progress -> Done

0:20  Writer & Reviewer report completion
      Kanban shows: Both tasks in "Done" column

0:22  Lead agent merges branches
      +---------------------------------+
      | $ git fetch origin              |
      | $ git merge origin/writer-prd   |
      | $ git merge origin/reviewer-types|
      | $ git worktree remove ./writer-prd|
      | $ git worktree remove ./reviewer-types
      +---------------------------------+

      Result: clean, linear history

0:24  Tests pass, deploy
      $ pnpm test
      $ git push origin main
```

---

## Branch Structure

```
BEFORE WORKTREES:
-------------------------------------
main: o--o--o--o  (HEAD)

AFTER SPAWNING AGENTS:
-------------------------------------
main:         o--o--o--o  (HEAD in /repo)
              |
              +- worktree 1
              |  +- writer-prd: o-----o--o  (HEAD in worktrees/writer-prd)
              |
              +- worktree 2
                 +- reviewer-types: o----o--o  (HEAD in worktrees/reviewer-types)

AFTER MERGING:
-------------------------------------
main: o--o--o--o--/--o--/--o  (merged both branches)
      |           |      |
      |     (writer-prd) |
      |                  (reviewer-types)
      +- Original HEAD
```

---

## Tmux Pane Layout

```
Connected via tmux to a 3-pane session:

+-------------------------+----------------------+
|                         |                      |
|   PANE 0: LEAD          |   PANE 1: WRITER     |
|   (main branch)         |   (writer-prd branch)|
|                         |                      |
|   $ pwd                 |   $ pwd              |
|   /repo                 |   /repo/...writer-prd|
|                         |                      |
|   $ git branch          |   $ git branch       |
|   * main                |   * writer-prd       |
|                         |     main             |
|                         |                      |
|   Watching kanban       |   Working...         |
|   (browser)             |   git commit         |
|                         |   task complete      |
+-------------------------+----------------------+
|                         |                      |
|   PANE 2: SHARED        |   PANE 3: REVIEWER   |
|   (merge staging)       |   (reviewer branch)  |
|                         |                      |
|   $ git fetch origin    |   $ pwd              |
|   $ git merge ...       |   /repo/...reviewer  |
|                         |                      |
|   After agents done,    |   $ git branch       |
|   lead merges here      |   * reviewer-types   |
|                         |     main             |
|                         |                      |
|                         |   Working...         |
|                         |   git commit         |
|                         |   task complete      |
+-------------------------+----------------------+

Navigation:
  Alt+Left   -> Lead pane
  Alt+Right  -> Agent panes
  Alt+Up/Down -> Vertical navigation
```

---

## Git Lock Mechanics

```
SCENARIO: Two agents try same branch

Lead's worktree (main):
  /repo
  +- .git/
     +- index   (locks main)

Writer's worktree (writer-prd):
  /repo/.../writer-prd
  +- .git -> ../../.git
     +- index.lock (writer-prd branch)

Reviewer's worktree (reviewer-types):
  /repo/.../reviewer-types
  +- .git -> ../../.git
     +- index.lock (reviewer-types branch)

If Reviewer tries to checkout writer-prd:
  ERROR: fatal: unable to create '.../writer-prd/index.lock'
     (branch is already checked out in another worktree)

Solution: Each agent gets UNIQUE branch name
  Lead: main
  Writer: writer-prd       <- unique
  Reviewer: reviewer-types <- unique
  OK: No conflicts
```

---

## Merge Decision Tree

```
START: Two agents have completed work

    +------------------------------------------+
    | Which branch modifies fewer files?       |
    +------------------------------------------+
              |
              +- Writer (3 files: docs/)        Merge Writer first
              |  +- git merge origin/writer-prd
              |
              +- Reviewer (7 files: src/, test/) Merge Reviewer second
                 +- git merge origin/reviewer-types

    RULE: Merge least-conflicting first.
          If files don't overlap, order doesn't matter.
          If files overlap, put simplest changes in first.
```

---

## Worktree Lifecycle

```
1. CREATE
   +- Lead spawns Agent with isolation: "worktree"
   |  +- Claude Code calls EnterWorktree("writer-prd")
   |
   +- Result: git worktree add .claude/worktrees/writer-prd -b writer-prd
      /repo/.claude/worktrees/writer-prd/
      +- .git -> ../../.git (symlink)
      +- src/
      +- [files checked out on writer-prd branch]


2. WORK
   +- Agent modifies files on writer-prd branch
   +- git add .
   +- git commit -m "..."
   +- pnpm task complete <id>
   |
   +- Result: commits exist on writer-prd branch


3. REVIEW (Lead)
   +- git fetch origin
   +- git log origin/writer-prd ^main    (see new commits)
   +- git diff main...origin/writer-prd  (see changes)
   |
   +- Decision: looks good -> merge


4. MERGE (Lead)
   +- git merge --no-ff origin/writer-prd
   |  +- Creates merge commit (preserves history)
   |
   +- Result: commits integrated into main


5. CLEANUP (Lead)
   +- git branch -d writer-prd           (delete local branch)
   +- git push origin :writer-prd        (delete remote branch)
   +- git worktree remove ./worktrees/writer-prd
   |
   +- Result: worktree deleted, branch gone, clean slate


6. VERIFY
   +- git worktree list                (should only show /repo on main)
   +- git branch -a                    (should not list writer-prd)
   |
   +- Result: ready for next agent pair
```

---

## Error Recovery Flowchart

```
Something went wrong?

    +-------------------------------------------+
    | Did agent commit their changes?            |
    +-------------------------------------------+
              |
              +- YES
              |   +- Worktree safe, changes in branch
              |       +- git log origin/<branch> to see commits
              |
              +- NO
                  +- Were they committed locally?
                     +- Still in worktree?
                        +- YES: git status -> git commit (save it!)
                        +- NO:  Changes are lost


    +-------------------------------------------+
    | "fatal: unable to create .git/index.lock"  |
    +-------------------------------------------+
              |
              +- Worktree A is stuck trying same branch as B
                 +- Check: git worktree list
                 +- Use unique branch names
                 +- Or: rm -f .git/index.lock (if safe)


    +-------------------------------------------+
    | Stale worktree showing in list?           |
    +-------------------------------------------+
              |
              +- Worktree deleted outside git, refs still exist
                 +- git worktree prune
                 +- git worktree list (verify gone)


    +-------------------------------------------+
    | node_modules corrupted?                   |
    +-------------------------------------------+
              |
              +- Multiple agents ran pnpm install
                 +- Lead: pnpm install once, commit lockfile
                 +- Agents: use existing node_modules (read-only)
                 +- Or: git worktree add ... && pnpm install --frozen
```

---

## Decision Matrix: When to Use Worktrees

```
+=====================================================+
| Scenario                          | Worktree? | Why |
+=====================================================+
| Lead alone on main                | NO    | Overkill  |
| Lead + 1 agent parallel (2)      | YES   | Prevent conflict |
| Lead + 2 agents parallel (3)     | YES   | True parallel |
| Sequential: Agent A, then B      | NO    | Branch switch |
| Hotfix on main while feature     | YES   | Independence |
| Read-only research agent         | NO    | No write ops |
| AFK session: 3 independent tasks | YES   | Task isolation |
| Single agent, single task        | NO    | Overhead |
+=====================================================+
```

---

## Deployment Pipeline

```
+-----------------------------------------------------------------+
|                                                                  |
|  DEVELOPMENT (Agent Worktrees)                                   |
|  ============================================================    |
|                                                                  |
|  Agent A work        Agent B work         Lead reviews          |
|  in writer branch    in reviewer branch   (main branch)         |
|     |                    |                    |                  |
|     +- git commit        +- git commit        |                  |
|     +- pnpm test         +- pnpm test         |                  |
|     +- task complete     +- task complete     |                  |
|                                               |                  |
|                          v                    v                  |
+-----------------------------------------------------------------+
|                                                                  |
|  MERGE (Lead)                                                    |
|  ============================================================    |
|                                                                  |
|  git fetch origin                                                |
|  git merge --no-ff origin/writer-prd                             |
|  git merge --no-ff origin/reviewer-types                         |
|  pnpm test  <- Verify merged state                               |
|                                                                  |
+-----------------------------------------------------------------+
                          v
+-----------------------------------------------------------------+
|                                                                  |
|  CI/CD (GitHub + Deploy)                                         |
|  ============================================================    |
|                                                                  |
|  git push origin main                                            |
|       v                                                          |
|  CI Pipeline:                                                    |
|       +- pnpm test                                               |
|       +- pnpm build                                              |
|       +- Trigger deploy                                          |
|       v                                                          |
|  Deploy to production                                            |
|                                                                  |
+-----------------------------------------------------------------+
```

---

## Summary

Git worktrees enable **true parallel work** without conflicts:

- Each agent gets own working directory + branch
- Lead agent coordinates spawning, reviewing, merging
- Real-time kanban shows progress (SSE)
- Clean git history (no stash/rebase mess)
- Scales from 2 to 5+ agents

**To start:** Read `README-WORKTREES.md`, spawn agents with `isolation: "worktree"`.
