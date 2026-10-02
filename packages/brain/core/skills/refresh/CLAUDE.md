---
name: refresh
description: 'Re-sync active workspace context from admin app.'
user_invocable: true
---

# /refresh — Workspace & Project Context Resync

Reads the active workspace state and resolves the full context chain: workspace → branch → project → PR.

## Behavior

1. Read `~/.claude/state/active-workspace.json`
2. Validate the data is fresh (< 30 minutes old)
3. Detect the current git branch via `git branch --show-current`
4. If on a feature branch, resolve the context chain:
   - Query the admin API: `GET /api/github/context?workspace_id={id}&branch={branch}`
   - Display the full context summary (project name, PR number, CI status, tasks remaining)
   - Write the resolved context to `~/.claude/state/active-context.json`
5. If on `main`, just confirm workspace context (no project/PR resolution)
6. Report any file conflicts or rebase warnings from the context response

## Usage

```
/refresh
```

## Instructions

When this skill is invoked:

1. Read the file `~/.claude/state/active-workspace.json` from the user's home directory (`~/.claude/state/`).
2. Parse the JSON. It contains: `workspace_id`, `workspace_name`, `slug`, `updated_at`.
3. Check freshness: compare `updated_at` to current time. If older than 30 minutes, warn the user that the workspace context may be stale and suggest they open/refresh the Celune admin app.
4. If the file is missing, tell the user no workspace is synced and they should open the admin app.
5. If fresh, confirm the active workspace:
   - "Active workspace: **{workspace_name}** (`{slug}`)"
   - Include the workspace ID for reference

6. **Git context resolution** (new):
   - Run `git branch --show-current` to get the active branch
   - If on `main` or `master`: skip project resolution, just show workspace context
   - If on a feature branch:
     a. Call: `GET {apiUrl}/api/github/context?workspace_id={workspace_id}&branch={branch_name}`
     - Use the admin app's API URL (from NEXT_PUBLIC_SUPABASE_URL or hardcoded localhost:3002)
       b. If the API returns a project context, display:
     ```
     Working on **{project_name}**, PR #{pr_number} ({pr_status}). {tasks_remaining} tasks remaining.
     ```
     c. If file conflicts are returned, warn:
     ```
     ⚠ File conflict with {project_name}: {files}
     ```
     d. If `commits_behind_main` exceeds the workspace's `rebase_threshold_commits`, suggest:
     ```
     Branch is {N} commits behind main. Consider rebasing.
     ```
     e. Write the full context to `~/.claude/state/active-context.json`:
     ```json
     {
       "workspace_id": "...",
       "workspace_name": "...",
       "project_id": "...",
       "project_name": "...",
       "branch": "...",
       "pr_number": 12,
       "pr_status": "open",
       "updated_at": "..."
     }
     ```
     f. If the API returns no project match:
     ```
     On branch {branch} — no linked project. Use /build to create one.
     ```

7. Keep the response concise — this is a quick context check.
