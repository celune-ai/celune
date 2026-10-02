# Schema Tracking

Tables and objects managed in migration files vs. the base schema.

## Base Schema (`supabase-schema.sql`)

Initial tables created by the base schema file:

| Table           | Description                  |
| --------------- | ---------------------------- |
| `projects`      | Project records              |
| `tasks`         | Task records (kanban)        |
| `activity_log`  | Event/activity feed          |
| `task_comments` | Comments on tasks            |
| `agent_status`  | Agent heartbeat/status       |
| `agent_configs` | Agent personality and config |
| `agent_memory`  | Semantic memory entries      |

`agent_audit_log` and `agent_delegations` were listed here before 2026-09-26. Neither exists in the hosted project or in any migration, and no code reads them. Agent audit rows live in `activity_log` (see 008).

## Migration-Added Objects

| Migration                                    | Object                                                                                                                                                                                                                                                                                                                                                   | Type                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 001                                          | `organizations`, `org_memberships`, `workspaces`, `user_preferences`, `user_org_ids()`, `user_admin_org_ids()`, `prevent_org_deletion()`, updated_at triggers, RLS                                                                                                                                                                                       | Tables, Functions, Triggers, Policies (baseline reconstructed from the hosted project) |
| 006                                          | `tasks.parent_id`                                                                                                                                                                                                                                                                                                                                        | Column                                                                                 |
| 007                                          | `agent_memory`                                                                                                                                                                                                                                                                                                                                           | Table                                                                                  |
| 008                                          | `activity_log.agent_id`, agent activity indexes                                                                                                                                                                                                                                                                                                          | Column, Indexes                                                                        |
| 009                                          | `tasks.depends_on`, `tasks.context_keys`                                                                                                                                                                                                                                                                                                                 | Columns                                                                                |
| 010                                          | `activity_log.acknowledged`                                                                                                                                                                                                                                                                                                                              | Column                                                                                 |
| 011                                          | `claude_usage`                                                                                                                                                                                                                                                                                                                                           | Table                                                                                  |
| 012                                          | `activity_log.agent_id`                                                                                                                                                                                                                                                                                                                                  | Column                                                                                 |
| 014                                          | `projects.prd_content`, `prd_metadata`                                                                                                                                                                                                                                                                                                                   | Columns                                                                                |
| 015                                          | `portfolio_passwords`                                                                                                                                                                                                                                                                                                                                    | Table                                                                                  |
| 016                                          | `tasks.outcome`                                                                                                                                                                                                                                                                                                                                          | Column                                                                                 |
| 017                                          | `projects.project_type`                                                                                                                                                                                                                                                                                                                                  | Column                                                                                 |
| 018                                          | `tasks.completed_at` auto-trigger                                                                                                                                                                                                                                                                                                                        | Trigger                                                                                |
| 019                                          | `tasks.effort_estimate`, `effort_actual`                                                                                                                                                                                                                                                                                                                 | Columns                                                                                |
| 020                                          | `project_groups`                                                                                                                                                                                                                                                                                                                                         | Table                                                                                  |
| 021                                          | `*.user_id`, `*.org_id`, `*.workspace_id`                                                                                                                                                                                                                                                                                                                | Columns (multi-tenant)                                                                 |
| 022                                          | Backfill `user_id` on existing rows                                                                                                                                                                                                                                                                                                                      | Data migration                                                                         |
| 023                                          | RLS policies (user-scoped)                                                                                                                                                                                                                                                                                                                               | Policies                                                                               |
| 024                                          | `user_roles`                                                                                                                                                                                                                                                                                                                                             | Table                                                                                  |
| 025                                          | `activity_log.actor_user_id`                                                                                                                                                                                                                                                                                                                             | Column                                                                                 |
| 026                                          | `billing_*` tables                                                                                                                                                                                                                                                                                                                                       | Tables                                                                                 |
| 027                                          | `user_roles.is_active`, `handle_new_user()` trigger                                                                                                                                                                                                                                                                                                      | Column, Trigger                                                                        |
| 027_reconstructed_hosted_columns             | `agent_configs.workspace_id`, `agent_status.workspace_id`, `claude_usage.user_id`/`workspace_id`, `project_groups.workspace_id`/`branch`/`pr_url`/`pr_number`/`base_branch`                                                                                                                                                                              | Columns (hand-added on the hosted project; later files read them)                      |
| 028                                          | `get_users_for_org()` RPC, invite role trigger, null workspace RLS fix                                                                                                                                                                                                                                                                                   | Functions, Policies                                                                    |
| 029                                          | `workspace_memberships`, `user_workspace_ids()`, workspace-aware RLS                                                                                                                                                                                                                                                                                     | Table, Function, Policies                                                              |
| 20260303                                     | Rename agent assignees                                                                                                                                                                                                                                                                                                                                   | Data migration                                                                         |
| 20260304                                     | `projects.project_type` values, voice settings, project priority                                                                                                                                                                                                                                                                                         | Columns                                                                                |
| 20260305                                     | org_id indexes, org_memberships RLS fix, project_groups.org_id                                                                                                                                                                                                                                                                                           | Indexes, Policies, Columns                                                             |
| 20260926_reconstruct_hosted_drift            | `feedback.org_id`, `task_attachments.user_id`, `auth.uid()` owner defaults, `projects.project_type`/`priority` enum conversion, missing FKs on tasks/projects/activity_log/task_comments/user_roles, 10 indexes, 14 policies, prod bodies of `auto_unblock_dependents`, `get_users_by_ids`, `get_invitation_user`, `get_pending_invitations`, `exec_sql` | Reconstructed from the hosted project                                                  |
| 20260926_ai_job_queue_runner                 | `ai_job_type` value `agent_run`, `ai_job_queue` runner columns, `job_logs`; drops the `execution_queue` claim RPC                                                                                                                                                                                                                                        |
| 20260926_fold_execution_queue                | Moves `execution_queue` and `execution_logs` rows into `ai_job_queue` and `job_logs`; read-only views keep the old names                                                                                                                                                                                                                                 |
| 20260927_workspace_ai_budget                 | `workspaces.ai_token_limit_monthly`, `workspaces.ai_requests_per_minute` (NULL is unlimited)                                                                                                                                                                                                                                                             |
| 20260927_harness_event_ledger                | `harness_event_ledger` (dedupe of `/v1/harness/events` ids per workspace; service role only)                                                                                                                                                                                                                                                             |
| 20260927_harness_connections                 | `harness_connections` (harness name, agent map, and non-secret config per workspace; service role only)                                                                                                                                                                                                                                                  |
| 20260928_tenant_scoped_rls                   | RLS: `task_attachments` scoped through the task workspace, `claude_usage` through the row workspace, `slack_connections` manage needs `settings:manage`, `agent_status` drops NULL-workspace branches; anon grants revoked on all four                                                                                                                   |
| 20260927_revoke_user_execute_on_definer_rpcs | Revokes `anon` and `authenticated` EXECUTE on SECURITY DEFINER RPCs that take a tenant id; pins `search_path` on four                                                                                                                                                                                                                                    |
| 20260928_definer_rls_helpers_check_caller    | `user_workspace_ids` and `user_has_permission` answer only for `auth.uid()` when called by `anon` or `authenticated`                                                                                                                                                                                                                                     |
| 20260928_secret_column_select_grants         | `anon` loses access to `provider_api_keys` and `slack_connections`; `authenticated` reads every column except the secret ones                                                                                                                                                                                                                            |
| 20260929_cloud_per_seat_plan                 | `subscriptions` created when missing, `subscriptions.seats` and `billing_interval`; legacy plan names on `subscriptions` and `access_codes` become `cloud` (`access_codes.plan` is `cloud` or `enterprise`); `check_memory_quota` no longer caps; `get_memory_ttl_days` returns -1                                                                       |

### Hosted reconstruction (2026-09-26)

The hosted project was changed by hand for months. On 2026-09-26 its
catalog was read (SELECT only) and diffed against a database booted from this directory.
Four files carry the reconstruction: `001-baseline-organizations-workspaces.sql`,
`027_reconstructed_hosted_columns.sql`, `20260926_project_type_system_value.sql`,
`20260926_reconstruct_hosted_drift.sql`.
Mark them applied on the hosted project with `pnpm --filter @repo/db migrate -- --backfill`
(they are no-ops there). 001 also stops itself with an "already exists" error on any
database that already has `organizations`, so a plain migrate run cannot replace the
RBAC v2 helpers or policies.

`20260927_org_members_rls_recursion.sql` is a real fix and must run on the hosted project
through a normal migrate run. It replaces the recursive `org_members_select_org_staff`
policy with one that calls the SECURITY DEFINER helper `org_staff_org_ids()`.

Legacy files edited so an empty database boots in bytewise order (hash mismatch warnings
from `migrate:status` are expected): 022 (no-user skip), 20260306*rbac_v2_org_members
(moddatetime replaced), 20260306_rename_assigned_to_scoping (guard),
20260308_notification_preferences (slack admin policy), 20260309_workspace_invitations
(syntax), 20260310_cr_fixes_rpc_scoping_rls (sections moved to the files that create the
objects), 20260312_backfill_org_github_installations (guard), 20260313_brain_content_base
(guard), 20260313_brain_section_hashes (`set_updated_at`), 20260313_conversation_logs*_
(constraint order), 20260313*rename_free_to_build_plan (guard), 20260317_heartbeat_system
(cron_jobs columns), 20260322_seed_skill_packs (guard; seed skipped on a fresh database),
20260323_vault_sync*_ (policies moved), 20260329_knowledge_base_tables (guard),
20260331_ai_job_queue (pg_cron optional).

Differences left in place after the reconstruction: `tasks.workspace_id` stays NOT NULL
(hosted: nullable); `workspace_invitations` keeps the partial unique index (hosted: full
unique constraint); `set_completed_at` trigger, `activity_log.acknowledged`,
`cron_jobs.user_id`, `knowledge_items`, `knowledge_syncs`, `subscriptions`, `usage_records`
exist here and not on the hosted project; `task_status` enum label order differs;
`claim_execution_job`, `rollup_usage_summaries` and `update_updated_at` keep the repo bodies.
`20260929_cloud_per_seat_plan.sql` creates `subscriptions` on the hosted project.

## Enums

| Enum                | Values                                                                  | Added By |
| ------------------- | ----------------------------------------------------------------------- | -------- |
| `task_status`       | backlog, inbox, planning, assigned, in_progress, review, done, archived | Base     |
| `task_priority`     | urgent, high, normal, low                                               | Base     |
| `project_status`    | active, paused, completed, archived                                     | Base     |
| `severity_level`    | info, warning, error                                                    | Base     |
| `agent_status_type` | online, offline, working, idle                                          | Base     |

## Key Functions

| Function                      | Purpose                                                            | Migration |
| ----------------------------- | ------------------------------------------------------------------ | --------- |
| `user_org_ids()`              | Org IDs the current user belongs to (SECURITY DEFINER)             | 001       |
| `user_admin_org_ids()`        | Org IDs where the user is owner/admin; RBAC v2 version in 20260306 | 001       |
| `prevent_org_deletion()`      | Blocks deleting an org that still has tasks or extra workspaces    | 001       |
| `user_workspace_ids(uid)`     | Returns workspace IDs visible to a user (SECURITY DEFINER)         | 029       |
| `handle_new_user()`           | Auto-creates user_roles entry on auth.users insert                 | 027       |
| `get_users_for_org(org_uuid)` | Returns users with roles for an org                                | 028       |
| `match_memories()`            | Semantic memory search via pgvector                                | 007       |

## Migration Naming Convention

**All new migrations MUST use date-based naming:**

```
YYYYMMDD_short_description.sql
```

Examples:

- `20260306_add_workspace_labels.sql`
- `20260307_fix_rls_viewer_policy.sql`

Legacy migrations (001-029) use sequential numbering. Do not rename them; Supabase tracks applied migrations by filename. The date-based format prevents numbering collisions when multiple developers create migrations on the same day.

`001-baseline-organizations-workspaces.sql` is the one exception added after the date-based rule. It has to sort before 028, which is the first migration that reads `workspaces`, so it carries a numeric prefix.

## Apply Order

`scripts/boot-local.sh` picks one of two paths, then asserts that every `CREATE TABLE` in this directory exists.

**Empty database (fresh install).** A database with no public tables and no `public._migrations` gets:

1. `baseline/0001_baseline.sql` in one transaction. It holds the schema every migration up to the baseline produced and records those files in `public._migrations` with their hashes.
2. Every file in `migrations/` that the baseline does not record, sorted bytewise (`LC_ALL=C sort`). Today that is `20260927_harness_connections.sql`, `20260927_harness_event_ledger.sql`, `20260927_revoke_user_execute_on_definer_rpcs.sql`, `20260928_definer_rls_helpers_check_caller.sql`, `20260928_org_scoped_permissions.sql`, `20260928_platform_owner_marker.sql`, `20260928_secret_column_select_grants.sql`, `20260928_tenant_scoped_rls.sql`, `20260929_cloud_per_seat_plan.sql`, and `20260929_vector_search_functions.sql`.

**Existing database, or `BOOT_BASELINE=0`.** Any other database, or an empty one booted with `BOOT_BASELINE=0` to test the incremental chain, gets:

1. `supabase-schema.sql` (enums and the seven base tables), when `public._migrations` is missing
2. Every file in `migrations/` not yet recorded in `public._migrations`, sorted bytewise (the same order `scripts/migrate.mjs` uses)

A re-run applies only files that are not recorded yet. Files the baseline records must not change after it is generated, because fresh installs skip them; add a new migration instead, or regenerate the baseline with `scripts/generate-baseline.mjs`. `scripts/check-baseline.mjs` fails when a recorded file changed, and the CI `schema` job runs it, then boots an empty database twice and expects the second run to apply nothing.

## Notes

- RLS is enforced on all user-facing tables; service role bypasses for admin operations
- `workspace_memberships` controls data visibility for member/viewer roles
- Some legacy migrations have duplicate numbers (e.g., multiple 027s, 028s) — applied in order
