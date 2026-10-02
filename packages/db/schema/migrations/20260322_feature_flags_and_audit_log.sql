-- Feature flags table
CREATE TABLE IF NOT EXISTS feature_flags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  flag_type     TEXT NOT NULL DEFAULT 'boolean' CHECK (flag_type IN ('boolean', 'multivariate', 'remote_config')),
  enabled       BOOLEAN NOT NULL DEFAULT false,
  variants      JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload       JSONB,
  rules         JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_variant TEXT,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit log for flag changes
CREATE TABLE IF NOT EXISTS feature_flag_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_id       UUID NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
  action        TEXT NOT NULL CHECK (action IN ('created', 'updated', 'toggled', 'deleted')),
  changes       JSONB,
  performed_by  UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes (key already has a unique index from the UNIQUE constraint)
CREATE INDEX idx_feature_flags_enabled ON feature_flags(enabled);
CREATE INDEX idx_feature_flag_audit_log_flag_id ON feature_flag_audit_log(flag_id);
CREATE INDEX idx_feature_flag_audit_log_created_at ON feature_flag_audit_log(created_at DESC);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_feature_flags_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_feature_flags_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW
  EXECUTE FUNCTION update_feature_flags_updated_at();

-- RLS policies (admin-only via service role — no user-facing RLS needed)
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flag_audit_log ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS, so these policies just block anon/authenticated direct access
CREATE POLICY "feature_flags_no_public_access" ON feature_flags
  FOR ALL USING (false);

CREATE POLICY "feature_flag_audit_log_no_public_access" ON feature_flag_audit_log
  FOR ALL USING (false);
