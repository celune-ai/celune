-- Analytics aggregate RPCs: move JS-side summation to Postgres
-- Used by /api/analytics/cost and /api/analytics/dashboard

-- 1. Cost route aggregation: sum tokens_spent, cost_cents, time_active_minutes, handoff count
--    from done tasks with metadata, scoped to workspace(s).
CREATE OR REPLACE FUNCTION analytics_cost_aggregates(
  p_workspace_id uuid DEFAULT NULL,
  p_workspace_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  total_tokens bigint,
  total_cost bigint,
  total_time_minutes numeric,
  handoff_count bigint,
  tasks_with_cost bigint
)
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(SUM((metadata->>'tokens_spent')::bigint), 0) AS total_tokens,
    COALESCE(SUM((metadata->>'cost_cents')::bigint), 0) AS total_cost,
    COALESCE(SUM((metadata->>'time_active_minutes')::numeric), 0) AS total_time_minutes,
    COALESCE(SUM(jsonb_array_length(CASE WHEN metadata ? 'agent_handoffs' AND jsonb_typeof(metadata->'agent_handoffs') = 'array' THEN metadata->'agent_handoffs' ELSE '[]'::jsonb END)), 0) AS handoff_count,
    COUNT(*) FILTER (WHERE
      metadata ? 'tokens_spent' OR metadata ? 'cost_cents' OR metadata ? 'time_active_minutes'
    ) AS tasks_with_cost
  FROM tasks
  WHERE status = 'done'
    AND metadata IS NOT NULL
    AND (
      (p_workspace_ids IS NOT NULL AND workspace_id = ANY(p_workspace_ids))
      OR (p_workspace_id IS NOT NULL AND workspace_id = p_workspace_id)
      OR (p_workspace_ids IS NULL AND p_workspace_id IS NULL)
    );
$$;

-- 2. Dashboard: daily task completion counts for last N days, scoped to workspace(s).
CREATE OR REPLACE FUNCTION analytics_daily_completions(
  p_since timestamptz,
  p_workspace_id uuid DEFAULT NULL,
  p_workspace_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  day date,
  count bigint
)
LANGUAGE sql STABLE
AS $$
  SELECT
    (completed_at AT TIME ZONE 'UTC')::date AS day,
    COUNT(*) AS count
  FROM tasks
  WHERE status = 'done'
    AND completed_at IS NOT NULL
    AND completed_at >= p_since
    AND (
      (p_workspace_ids IS NOT NULL AND workspace_id = ANY(p_workspace_ids))
      OR (p_workspace_id IS NOT NULL AND workspace_id = p_workspace_id)
      OR (p_workspace_ids IS NULL AND p_workspace_id IS NULL)
    )
  GROUP BY (completed_at AT TIME ZONE 'UTC')::date
  ORDER BY day;
$$;

-- 3. Dashboard: daily cost from claude_usage for last N days, scoped to workspace(s).
CREATE OR REPLACE FUNCTION analytics_daily_cost(
  p_since timestamptz,
  p_workspace_id uuid DEFAULT NULL,
  p_workspace_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  day date,
  total_cost numeric
)
LANGUAGE sql STABLE
AS $$
  SELECT
    (created_at AT TIME ZONE 'UTC')::date AS day,
    COALESCE(SUM(total_cost_usd), 0) AS total_cost
  FROM claude_usage
  WHERE created_at >= p_since
    AND (
      (p_workspace_ids IS NOT NULL AND workspace_id = ANY(p_workspace_ids))
      OR (p_workspace_id IS NOT NULL AND workspace_id = p_workspace_id)
      OR (p_workspace_ids IS NULL AND p_workspace_id IS NULL)
    )
  GROUP BY (created_at AT TIME ZONE 'UTC')::date
  ORDER BY day;
$$;

-- 4. Dashboard: sum of claude_usage cost for a date range, scoped to workspace(s).
CREATE OR REPLACE FUNCTION analytics_cost_sum(
  p_since timestamptz,
  p_until timestamptz DEFAULT NULL,
  p_workspace_id uuid DEFAULT NULL,
  p_workspace_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  total_cost numeric
)
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(SUM(total_cost_usd), 0) AS total_cost
  FROM claude_usage
  WHERE created_at >= p_since
    AND (p_until IS NULL OR created_at < p_until)
    AND (
      (p_workspace_ids IS NOT NULL AND workspace_id = ANY(p_workspace_ids))
      OR (p_workspace_id IS NOT NULL AND workspace_id = p_workspace_id)
      OR (p_workspace_ids IS NULL AND p_workspace_id IS NULL)
    );
$$;
