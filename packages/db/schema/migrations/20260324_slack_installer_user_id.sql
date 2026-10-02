-- Add installer_slack_user_id to slack_connections
-- Stores the Slack user ID of the person who installed the bot (authed_user.id from OAuth).
-- Used as DM fallback when no channel is configured for notifications.
ALTER TABLE slack_connections
  ADD COLUMN IF NOT EXISTS installer_slack_user_id TEXT;

-- Backfill: no data to backfill since we didn't store this before.
-- It will be populated on next OAuth connection/reconnection.
