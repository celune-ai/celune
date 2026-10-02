-- Performance: SQL-side aggregation RPCs for analytics endpoints
-- Replaces JS-side Map/filter aggregation with efficient GROUP BY queries

-- 1. Cost summary: per-agent and per-model totals
CREATE OR REPLACE FUNCTION analytics_cost_by_agent(
  p_workspace_id uuid DEFAULT NULL,
  p_workspace_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
  agent_name text,
  total_cost_usd numeric,
  input_tokens bigint,
  output_tokens bigint,
  request_count bigint
) LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(cu.agent_name, 'unknown') AS agent_name,
    SUM(cu.total_cost_usd)::numeric AS total_cost_usd,
    SUM(cu.input_tokens)::bigint AS input_tokens,
    SUM(cu.output_tokens)::bigint AS output_tokens,
    COUNT(*)::bigint AS request_count
  FROM claude_usage cu
  WHERE
    (p_workspace_ids IS NOT NULL AND cu.workspace_id = ANY(p_workspace_ids))
    OR (p_workspace_ids IS NULL AND p_workspace_id IS NOT NULL AND cu.workspace_id = p_workspace_id)
    OR (p_workspace_ids IS NULL AND p_workspace_id IS NULL)
  GROUP BY COALESCE(cu.agent_name, 'unknown')
  ORDER BY SUM(cu.total_cost_usd) DESC;
$$;

CREATE OR REPLACE FUNCTION analytics_cost_by_model(
  p_workspace_id uuid DEFAULT NULL,
  p_workspace_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
  model text,
  total_cost_usd numeric,
  input_tokens bigint,
  output_tokens bigint,
  request_count bigint
) LANGUAGE sql STABLE AS $$
  SELECT
    cu.model,
    SUM(cu.total_cost_usd)::numeric AS total_cost_usd,
    SUM(cu.input_tokens)::bigint AS input_tokens,
    SUM(cu.output_tokens)::bigint AS output_tokens,
    COUNT(*)::bigint AS request_count
  FROM claude_usage cu
  WHERE
    (p_workspace_ids IS NOT NULL AND cu.workspace_id = ANY(p_workspace_ids))
    OR (p_workspace_ids IS NULL AND p_workspace_id IS NOT NULL AND cu.workspace_id = p_workspace_id)
    OR (p_workspace_ids IS NULL AND p_workspace_id IS NULL)
  GROUP BY cu.model
  ORDER BY SUM(cu.total_cost_usd) DESC;
$$;

-- 2. Cost trend: daily cost by model bucket (opus/sonnet/haiku)
CREATE OR REPLACE FUNCTION analytics_cost_trend(
  p_since timestamptz,
  p_workspace_id uuid DEFAULT NULL,
  p_workspace_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
  day date,
  opus numeric,
  sonnet numeric,
  haiku numeric
) LANGUAGE sql STABLE AS $$
  SELECT
    (cu.created_at AT TIME ZONE 'UTC')::date AS day,
    ROUND(SUM(CASE WHEN LOWER(cu.model) LIKE '%opus%' THEN cu.total_cost_usd ELSE 0 END)::numeric, 2) AS opus,
    ROUND(SUM(CASE WHEN LOWER(cu.model) NOT LIKE '%opus%' AND LOWER(cu.model) NOT LIKE '%haiku%' THEN cu.total_cost_usd ELSE 0 END)::numeric, 2) AS sonnet,
    ROUND(SUM(CASE WHEN LOWER(cu.model) LIKE '%haiku%' THEN cu.total_cost_usd ELSE 0 END)::numeric, 2) AS haiku
  FROM claude_usage cu
  WHERE
    cu.created_at >= p_since
    AND (
      (p_workspace_ids IS NOT NULL AND cu.workspace_id = ANY(p_workspace_ids))
      OR (p_workspace_ids IS NULL AND p_workspace_id IS NOT NULL AND cu.workspace_id = p_workspace_id)
      OR (p_workspace_ids IS NULL AND p_workspace_id IS NULL)
    )
  GROUP BY (cu.created_at AT TIME ZONE 'UTC')::date
  ORDER BY day;
$$;

-- 3. Task velocity: completions per week
CREATE OR REPLACE FUNCTION analytics_velocity(
  p_weeks int DEFAULT 12,
  p_workspace_id uuid DEFAULT NULL,
  p_workspace_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
  week_start date,
  week_end date,
  count bigint
) LANGUAGE sql STABLE AS $$
  SELECT
    date_trunc('week', t.completed_at AT TIME ZONE 'UTC')::date AS week_start,
    (date_trunc('week', t.completed_at AT TIME ZONE 'UTC') + interval '6 days')::date AS week_end,
    COUNT(*)::bigint AS count
  FROM tasks t
  WHERE
    t.status = 'done'
    AND t.completed_at IS NOT NULL
    AND t.completed_at >= (NOW() - (p_weeks || ' weeks')::interval)
    AND (
      (p_workspace_ids IS NOT NULL AND t.workspace_id = ANY(p_workspace_ids))
      OR (p_workspace_ids IS NULL AND p_workspace_id IS NOT NULL AND t.workspace_id = p_workspace_id)
      OR (p_workspace_ids IS NULL AND p_workspace_id IS NULL)
    )
  GROUP BY date_trunc('week', t.completed_at AT TIME ZONE 'UTC')
  ORDER BY week_start;
$$;

-- 4. Priority breakdown: count of done tasks per priority
CREATE OR REPLACE FUNCTION analytics_priorities(
  p_workspace_id uuid DEFAULT NULL,
  p_workspace_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
  priority text,
  count bigint
) LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(t.priority, 'normal') AS priority,
    COUNT(*)::bigint AS count
  FROM tasks t
  WHERE
    t.status = 'done'
    AND (
      (p_workspace_ids IS NOT NULL AND t.workspace_id = ANY(p_workspace_ids))
      OR (p_workspace_ids IS NULL AND p_workspace_id IS NOT NULL AND t.workspace_id = p_workspace_id)
      OR (p_workspace_ids IS NULL AND p_workspace_id IS NULL)
    )
  GROUP BY COALESCE(t.priority, 'normal');
$$;

-- 5. Overview: aggregated task counts by status/date
CREATE OR REPLACE FUNCTION analytics_overview(
  p_workspace_id uuid DEFAULT NULL,
  p_workspace_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
  total bigint,
  in_progress bigint,
  done_today bigint,
  done_this_week bigint,
  overdue bigint,
  done_count bigint,
  source_breakdown jsonb
) LANGUAGE sql STABLE AS $$
  WITH filtered AS (
    SELECT t.status, t.completed_at, t.due_date, COALESCE(t.source, 'web') AS src
    FROM tasks t
    WHERE
      t.status != 'archived'
      AND (
        (p_workspace_ids IS NOT NULL AND t.workspace_id = ANY(p_workspace_ids))
        OR (p_workspace_ids IS NULL AND p_workspace_id IS NOT NULL AND t.workspace_id = p_workspace_id)
        OR (p_workspace_ids IS NULL AND p_workspace_id IS NULL)
      )
  ),
  week_bounds AS (
    SELECT
      date_trunc('week', NOW())::timestamptz AS week_start,
      (date_trunc('week', NOW()) + interval '6 days 23 hours 59 minutes 59 seconds')::timestamptz AS week_end
  )
  SELECT
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (WHERE f.status = 'in_progress')::bigint AS in_progress,
    COUNT(*) FILTER (WHERE f.status = 'done' AND f.completed_at >= date_trunc('day', NOW()))::bigint AS done_today,
    COUNT(*) FILTER (WHERE f.status = 'done' AND f.completed_at >= wb.week_start AND f.completed_at <= wb.week_end)::bigint AS done_this_week,
    COUNT(*) FILTER (WHERE f.status NOT IN ('done', 'archived') AND f.due_date IS NOT NULL AND f.due_date::timestamptz < NOW())::bigint AS overdue,
    COUNT(*) FILTER (WHERE f.status = 'done')::bigint AS done_count,
    COALESCE(
      (SELECT jsonb_object_agg(src, cnt) FROM (SELECT src, COUNT(*) AS cnt FROM filtered GROUP BY src) sub),
      '{}'::jsonb
    ) AS source_breakdown
  FROM filtered f
  CROSS JOIN week_bounds wb;
$$;

-- Rollback:
-- DROP FUNCTION IF EXISTS analytics_cost_by_agent(uuid, uuid[]);
-- DROP FUNCTION IF EXISTS analytics_cost_by_model(uuid, uuid[]);
-- DROP FUNCTION IF EXISTS analytics_cost_trend(timestamptz, uuid, uuid[]);
-- DROP FUNCTION IF EXISTS analytics_velocity(int, uuid, uuid[]);
-- DROP FUNCTION IF EXISTS analytics_priorities(uuid, uuid[]);
-- DROP FUNCTION IF EXISTS analytics_overview(uuid, uuid[]);
