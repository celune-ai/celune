-- sum_usage_events RPC: aggregates usage_events by event_type for a workspace since a given timestamp
-- Called by plan-enforcement.ts:74 to enforce plan limits without hitting Supabase's 1000-row default limit.
-- Uses composite index idx_usage_events_ws_type_created on (workspace_id, event_type, created_at).

CREATE OR REPLACE FUNCTION sum_usage_events(
  p_workspace_id uuid,
  p_since timestamptz
)
RETURNS TABLE(event_type text, total numeric)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT event_type, SUM(quantity)::numeric AS total
  FROM usage_events
  WHERE workspace_id = p_workspace_id
    AND created_at >= p_since
  GROUP BY event_type;
$$;

GRANT EXECUTE ON FUNCTION sum_usage_events(uuid, timestamptz) TO service_role;
