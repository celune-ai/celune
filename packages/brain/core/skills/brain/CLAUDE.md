---
name: brain
description: "Manage brain system — view status, sync, update, fork operations.\n  TRIGGER when: the user says '/brain', 'brain status', 'brain sync', 'brain update', or wants to manage the brain system.\n  DO NOT TRIGGER when: general conversation, project work, or task management."
user_invocable: true
---

# /brain — Brain System Management

Manage the workspace brain: view status, sync files, check for updates, manage forks.

## Arguments

`/brain [command]`

- `/brain` or `/brain status` — show brain status (files, versions, fork status)
- `/brain sync` — sync brain manifest from registry to Supabase
- `/brain update` — check for and apply available updates to brain files
- `/brain fork <path>` — mark a brain file as forked (user-customized)
- `/brain reset <path>` — reset a forked file back to the core version

## Commands

### status

Show the current state of the workspace brain:

- Total brain files and their tiers (essential/standard/premium)
- Files with available updates
- Forked files (user-customized, diverged from core)
- Last sync timestamp

### sync

Sync the brain manifest registry (from git) to the Supabase `brain_manifest` table for the active workspace:

1. Read `brain-manifest-registry.ts` from the repo
2. Compare SHA-256 hashes with what's in Supabase
3. Update records for changed files
4. Report what was synced

### update

Check for updates to brain files:

1. Query `brain_manifest` for files where `update_available = true`
2. For each:
   - If NOT forked: auto-apply the update (replace file content, update hash)
   - If forked: show AI-summarized diff (`update_summary`) and ask the user
3. Report results

### fork

Mark a brain file as user-customized:

1. Set `is_forked = true` in `brain_manifest`
2. Future updates will show as "available" but won't auto-apply
3. The user can review update summaries and decide whether to merge

### reset

Reset a forked file back to the core version:

1. Replace the file content with the current core version
2. Set `is_forked = false`, clear `update_available`
3. Update content hash

## TODO

<!-- This is a template for the brain management skill. Expand as the brain system matures with per-file update logic, AI-summarized diffs, and tier-gated access controls. -->
