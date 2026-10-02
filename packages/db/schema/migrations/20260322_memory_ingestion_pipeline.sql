-- Migration: Add memory_processed_at to activity_log for ingestion pipeline tracking
--
-- The memory ingestion pipeline reads unprocessed activity_log entries and
-- converts high-signal events into agent_memory entries. This column tracks
-- which entries have already been processed to avoid re-processing.

-- Add the processing timestamp column
ALTER TABLE activity_log
  ADD COLUMN IF NOT EXISTS memory_processed_at timestamptz DEFAULT NULL;

-- Index for efficiently finding unprocessed entries per workspace
CREATE INDEX IF NOT EXISTS idx_activity_log_memory_unprocessed
  ON activity_log (workspace_id, created_at)
  WHERE memory_processed_at IS NULL;

-- Comment for documentation
COMMENT ON COLUMN activity_log.memory_processed_at IS
  'Timestamp when this activity was processed by the memory ingestion pipeline. NULL = not yet processed.';
