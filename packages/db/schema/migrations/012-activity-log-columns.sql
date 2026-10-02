-- Migration 012: Add missing columns to activity_log
-- The TypeScript type (ActivityEntry) includes agent_id and acknowledged_at,
-- but these columns were never added to the actual table.
-- Run in Supabase SQL Editor.

-- Add agent_id column (nullable, no FK since agents are not in a table)
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS agent_id text;

-- Add acknowledged_at column (for alert dismissal feature)
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;

-- Index on agent_id for agent audit trail queries
CREATE INDEX IF NOT EXISTS idx_activity_log_agent_id ON activity_log(agent_id) WHERE agent_id IS NOT NULL;
