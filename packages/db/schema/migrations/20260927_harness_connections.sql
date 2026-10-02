-- Harness registrations per workspace, so an API restart keeps them.
-- One row per workspace: the harness name, the Celune agent to harness agent
-- map, and adapter settings. Credentials never go here; hosts keep them in the
-- environment or in the encrypted provider key storage, and the harness
-- factory reads them when it builds the adapter.
-- Only the service role reads or writes it; RLS is on with no policies.

CREATE TABLE IF NOT EXISTS harness_connections (
  workspace_id UUID        PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  org_id       UUID        REFERENCES organizations(id) ON DELETE CASCADE,
  harness      TEXT        NOT NULL CHECK (char_length(harness) BETWEEN 1 AND 100),
  agents       JSONB       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(agents) = 'object'),
  config       JSONB       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE harness_connections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE harness_connections FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE harness_connections TO service_role;

COMMENT ON TABLE harness_connections IS 'Harness registration per workspace (name, agent map, non-secret config). Service role only.';
