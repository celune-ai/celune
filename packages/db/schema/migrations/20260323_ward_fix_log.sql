-- WARD fix dedup log: provides DB-level uniqueness for error fingerprints
-- to prevent duplicate processing across serverless cold starts.
--
-- Part of: WARD Auto-Fix Agent (project e88de701)

CREATE TABLE IF NOT EXISTS ward_fix_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One processing attempt per workspace+fingerprint per hour
  -- Rows auto-expire via the cleanup index below
  UNIQUE (workspace_id, fingerprint)
);

-- Index for cleanup queries (purge entries older than 1 hour)
CREATE INDEX IF NOT EXISTS idx_ward_fix_log_created_at
  ON ward_fix_log (created_at);

-- RLS: only service role writes to this table (via pipeline)
ALTER TABLE ward_fix_log ENABLE ROW LEVEL SECURITY;

-- Workspace members can view their fix log
CREATE POLICY ward_fix_log_select ON ward_fix_log
  FOR SELECT USING (
    workspace_id IN (
      SELECT wm.workspace_id
      FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
    )
  );

-- Cleanup function: purge entries older than 1 hour to allow re-processing
-- Run via cron or called from the pipeline periodically
CREATE OR REPLACE FUNCTION cleanup_ward_fix_log(ttl_hours INTEGER DEFAULT 1)
RETURNS INTEGER AS $$
DECLARE
  deleted INTEGER;
BEGIN
  DELETE FROM ward_fix_log
  WHERE created_at < now() - (ttl_hours || ' hours')::INTERVAL;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- SECURITY DEFINER needed: cron job runs as service role to clean all workspaces

COMMENT ON FUNCTION cleanup_ward_fix_log IS 'Purge expired WARD dedup entries. Called by cron to keep the table small.';
