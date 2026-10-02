-- Usage rollup function: aggregates usage_events into usage_summaries
-- Called periodically (e.g., via pg_cron or an API endpoint) to maintain
-- pre-computed daily and monthly summaries for fast dashboard queries.

CREATE OR REPLACE FUNCTION rollup_usage_summaries(
  p_period_type TEXT DEFAULT 'daily',
  p_lookback_days INT DEFAULT 2
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT := 0;
  v_period_start DATE;
  v_period_end DATE;
  v_since TIMESTAMPTZ;
BEGIN
  v_since := NOW() - (p_lookback_days || ' days')::INTERVAL;

  IF p_period_type = 'daily' THEN
    -- Aggregate daily summaries
    INSERT INTO usage_summaries (workspace_id, period_type, period_start, metric, total, count)
    SELECT
      workspace_id,
      'daily',
      DATE_TRUNC('day', created_at)::DATE AS period_start,
      event_type AS metric,
      COALESCE(SUM(quantity), 0) AS total,
      COUNT(*) AS count
    FROM usage_events
    WHERE created_at >= v_since
    GROUP BY workspace_id, DATE_TRUNC('day', created_at)::DATE, event_type
    ON CONFLICT (workspace_id, period_type, period_start, metric)
    DO UPDATE SET
      total = EXCLUDED.total,
      count = EXCLUDED.count,
      updated_at = NOW();

    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_period_type = 'monthly' THEN
    -- Aggregate monthly summaries
    INSERT INTO usage_summaries (workspace_id, period_type, period_start, metric, total, count)
    SELECT
      workspace_id,
      'monthly',
      DATE_TRUNC('month', created_at)::DATE AS period_start,
      event_type AS metric,
      COALESCE(SUM(quantity), 0) AS total,
      COUNT(*) AS count
    FROM usage_events
    WHERE created_at >= DATE_TRUNC('month', NOW() - (p_lookback_days || ' days')::INTERVAL)
    GROUP BY workspace_id, DATE_TRUNC('month', created_at)::DATE, event_type
    ON CONFLICT (workspace_id, period_type, period_start, metric)
    DO UPDATE SET
      total = EXCLUDED.total,
      count = EXCLUDED.count,
      updated_at = NOW();

    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  RETURN v_count;
END;
$$;

-- Add unique constraint for upsert support (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'usage_summaries_upsert_key'
  ) THEN
    ALTER TABLE usage_summaries
    ADD CONSTRAINT usage_summaries_upsert_key
    UNIQUE (workspace_id, period_type, period_start, metric);
  END IF;
END $$;

-- Add count column if it doesn't exist (tracks number of events in summary)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'usage_summaries' AND column_name = 'count'
  ) THEN
    ALTER TABLE usage_summaries ADD COLUMN count INT NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Grant execute to service_role
GRANT EXECUTE ON FUNCTION rollup_usage_summaries TO service_role;
