-- Usage metering infrastructure: events + summaries
-- Part of Platform Readiness — Metering, Billing & API Access

-- Usage Events: granular event log for all billable actions
CREATE TABLE IF NOT EXISTS usage_events (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  org_id        uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type    text NOT NULL,  -- 'llm_tokens', 'tts_minutes', 'api_call', 'task_executed', 'storage_bytes'
  quantity      numeric NOT NULL DEFAULT 0,
  unit          text NOT NULL DEFAULT 'count',  -- 'tokens', 'minutes', 'bytes', 'count', 'usd'
  metadata      jsonb DEFAULT '{}',  -- model, agent_name, endpoint, etc.
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_usage_events_workspace ON usage_events(workspace_id);
CREATE INDEX idx_usage_events_org ON usage_events(org_id);
CREATE INDEX idx_usage_events_type ON usage_events(event_type);
CREATE INDEX idx_usage_events_created ON usage_events(created_at);
CREATE INDEX idx_usage_events_ws_type_created ON usage_events(workspace_id, event_type, created_at);

-- Usage Summaries: pre-aggregated rollups for fast dashboard queries
CREATE TABLE IF NOT EXISTS usage_summaries (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  org_id        uuid REFERENCES organizations(id) ON DELETE CASCADE,
  period_type   text NOT NULL,  -- 'daily', 'monthly'
  period_start  date NOT NULL,
  metric        text NOT NULL,  -- 'llm_tokens', 'llm_cost_usd', 'tts_minutes', 'api_calls', 'tasks_executed', 'storage_bytes'
  total         numeric NOT NULL DEFAULT 0,
  metadata      jsonb DEFAULT '{}',
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE(workspace_id, period_type, period_start, metric)
);

CREATE INDEX idx_usage_summaries_workspace ON usage_summaries(workspace_id);
CREATE INDEX idx_usage_summaries_org ON usage_summaries(org_id);
CREATE INDEX idx_usage_summaries_period ON usage_summaries(period_type, period_start);
CREATE INDEX idx_usage_summaries_ws_metric ON usage_summaries(workspace_id, metric, period_start);

-- RLS
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on usage_events"
  ON usage_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on usage_summaries"
  ON usage_summaries FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Users read own workspace usage_events"
  ON usage_events FOR SELECT TO authenticated
  USING (workspace_id IN (
    SELECT wm.workspace_id FROM workspace_memberships wm
    WHERE wm.user_id = auth.uid()
  ));

CREATE POLICY "Users read own workspace usage_summaries"
  ON usage_summaries FOR SELECT TO authenticated
  USING (workspace_id IN (
    SELECT wm.workspace_id FROM workspace_memberships wm
    WHERE wm.user_id = auth.uid()
  ));
