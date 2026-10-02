-- Migrate rate_limits table from legacy schema (client_id, attempts, blocked, first_attempt_at, last_attempt_at)
-- to atomic upsert schema (key, count, window_start, window_ms, updated_at).
-- This enables multi-instance rate limiting via a single atomic INSERT ... ON CONFLICT query.

-- Drop the old table and recreate with the new schema.
-- Existing rate limit state is ephemeral (short-lived windows), so no data migration needed.
DROP TABLE IF EXISTS rate_limits;

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_ms INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for cleanup of expired windows
CREATE INDEX idx_rate_limits_window ON rate_limits (window_start);

-- Enable RLS (service role bypasses it; no user-facing policies needed)
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Cleanup function: delete expired windows (call periodically via cron or manually)
CREATE OR REPLACE FUNCTION cleanup_rate_limits()
RETURNS void AS $$
BEGIN
  DELETE FROM rate_limits
  WHERE window_start + (window_ms || ' milliseconds')::interval < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comment explaining SECURITY DEFINER: needed because RLS is enabled and this function
-- is called by service role or cron, not by end users. It only deletes expired rows.
COMMENT ON FUNCTION cleanup_rate_limits() IS 'Deletes expired rate limit windows. SECURITY DEFINER because RLS is enabled and no user-facing policies exist.';

-- Atomic rate limit check: upsert + window expiry in a single call.
-- Returns the current count and window_start after the operation.
-- SECURITY DEFINER: needed because RLS is enabled with no user-facing policies;
-- this function is only called by service role from API routes.
CREATE OR REPLACE FUNCTION rate_limit_check(
  p_key TEXT,
  p_window_ms INTEGER
)
RETURNS TABLE(out_count INTEGER, out_window_start TIMESTAMPTZ) AS $$
BEGIN
  RETURN QUERY
  INSERT INTO rate_limits (key, count, window_start, window_ms)
  VALUES (p_key, 1, now(), p_window_ms)
  ON CONFLICT (key) DO UPDATE SET
    count = CASE
      WHEN rate_limits.window_start + (rate_limits.window_ms || ' milliseconds')::interval < now()
      THEN 1
      ELSE rate_limits.count + 1
    END,
    window_start = CASE
      WHEN rate_limits.window_start + (rate_limits.window_ms || ' milliseconds')::interval < now()
      THEN now()
      ELSE rate_limits.window_start
    END,
    window_ms = p_window_ms,
    updated_at = now()
  RETURNING rate_limits.count, rate_limits.window_start;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION rate_limit_check(TEXT, INTEGER) IS 'Atomic rate limit check via upsert. SECURITY DEFINER because RLS is enabled with no user-facing policies.';
