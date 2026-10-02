-- 023-activity-actor-user-id.sql
-- P1: Add actor_user_id to activity_log for per-user audit trail
-- Distinct from user_id (data ownership): actor_user_id tracks WHO performed the action.
-- Nullable so agent-originated events (no authenticated user) are valid.
--
-- ROLLBACK:
--   ALTER TABLE activity_log DROP COLUMN IF EXISTS actor_user_id;
--   DROP INDEX IF EXISTS idx_activity_log_actor_user_id;

ALTER TABLE activity_log
  ADD COLUMN IF NOT EXISTS actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_activity_log_actor_user_id ON activity_log(actor_user_id);

COMMENT ON COLUMN activity_log.actor_user_id IS
  'The authenticated user who performed the action (NULL for agent-only or system events)';
