-- 011-claude-usage.sql
-- Token cost optimization: track Claude API usage per session/agent/task
-- Supports daily aggregation view for cost reporting

CREATE TABLE IF NOT EXISTS claude_usage (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id            text NOT NULL,
  agent_name            text,
  task_id               uuid REFERENCES tasks(id) ON DELETE SET NULL,
  model                 text NOT NULL,
  input_tokens          integer NOT NULL DEFAULT 0,
  output_tokens         integer NOT NULL DEFAULT 0,
  cache_read_tokens     integer DEFAULT 0,
  cache_creation_tokens integer DEFAULT 0,
  total_cost_usd        numeric(10,6) NOT NULL DEFAULT 0,
  duration_ms           integer,
  created_at            timestamptz DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_claude_usage_agent_name  ON claude_usage (agent_name);
CREATE INDEX IF NOT EXISTS idx_claude_usage_task_id     ON claude_usage (task_id);
CREATE INDEX IF NOT EXISTS idx_claude_usage_model       ON claude_usage (model);
CREATE INDEX IF NOT EXISTS idx_claude_usage_created_at  ON claude_usage (created_at);

-- RLS: service_role full access, anon read-only
ALTER TABLE claude_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on claude_usage"
  ON claude_usage
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anon read-only on claude_usage"
  ON claude_usage
  FOR SELECT
  TO anon
  USING (true);

-- Daily aggregation view: cost + token totals by date and model
CREATE OR REPLACE VIEW claude_usage_daily AS
SELECT
  date_trunc('day', created_at)::date AS day,
  model,
  agent_name,
  count(*)                            AS request_count,
  sum(input_tokens)                   AS total_input_tokens,
  sum(output_tokens)                  AS total_output_tokens,
  sum(cache_read_tokens)              AS total_cache_read_tokens,
  sum(cache_creation_tokens)          AS total_cache_creation_tokens,
  sum(total_cost_usd)                 AS total_cost_usd
FROM claude_usage
GROUP BY date_trunc('day', created_at)::date, model, agent_name
ORDER BY day DESC, total_cost_usd DESC;
