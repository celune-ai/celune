-- Update claude_usage_daily view to include workspace_id for workspace filtering
DROP VIEW IF EXISTS claude_usage_daily;

CREATE VIEW claude_usage_daily AS
SELECT
  date_trunc('day', created_at)::date AS day,
  model,
  agent_name,
  workspace_id,
  count(*)                            AS request_count,
  sum(input_tokens)                   AS total_input_tokens,
  sum(output_tokens)                  AS total_output_tokens,
  sum(cache_read_tokens)              AS total_cache_read_tokens,
  sum(cache_creation_tokens)          AS total_cache_creation_tokens,
  sum(total_cost_usd)                 AS total_cost_usd
FROM claude_usage
GROUP BY date_trunc('day', created_at)::date, model, agent_name, workspace_id
ORDER BY day DESC, total_cost_usd DESC;
