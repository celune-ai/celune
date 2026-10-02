-- Dedupe ledger for harness run events (POST /v1/harness/events).
-- The primary key makes the dedupe atomic across API instances: the first
-- insert of a (workspace, event id) pair wins and a repeat gets 23505.
-- Only the service role writes it; RLS is on with no policies.

CREATE TABLE IF NOT EXISTS harness_event_ledger (
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_id     TEXT        NOT NULL CHECK (char_length(event_id) BETWEEN 1 AND 200),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_harness_event_ledger_created_at
  ON harness_event_ledger (created_at);

ALTER TABLE harness_event_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE harness_event_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE harness_event_ledger TO service_role;

COMMENT ON TABLE harness_event_ledger IS 'Harness run event ids already applied, per workspace. Service role only.';
