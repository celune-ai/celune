-- Platform Credentials Vault
-- Stores encrypted secrets for platform-wide service integrations (admin-only)

CREATE TABLE IF NOT EXISTS platform_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN ('discord','github','slack','stripe','ai_provider','encryption','sentry','vercel','nango','other')),
  key_name TEXT NOT NULL,
  encrypted_value BYTEA NOT NULL,
  value_iv BYTEA NOT NULL,
  value_suffix TEXT, -- last 4 chars for display
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active credential per category+key_name
CREATE UNIQUE INDEX idx_platform_credentials_active_unique
  ON platform_credentials (category, key_name)
  WHERE is_active = true;

CREATE INDEX idx_platform_credentials_category ON platform_credentials (category);
CREATE INDEX idx_platform_credentials_key_name ON platform_credentials (key_name);
CREATE INDEX idx_platform_credentials_is_active ON platform_credentials (is_active);

-- Audit log for credential operations
CREATE TABLE IF NOT EXISTS credential_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id UUID REFERENCES platform_credentials(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('created','updated','deleted','validated','accessed')),
  actor_id UUID REFERENCES auth.users(id),
  ip_address TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_credential_audit_log_credential_id ON credential_audit_log (credential_id);
CREATE INDEX idx_credential_audit_log_created_at ON credential_audit_log (created_at DESC);

-- RLS: service_role only (no user access)
ALTER TABLE platform_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE credential_audit_log ENABLE ROW LEVEL SECURITY;

-- No policies = only service_role can access (which bypasses RLS)

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_platform_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_platform_credentials_updated_at
  BEFORE UPDATE ON platform_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_platform_credentials_updated_at();

COMMENT ON TABLE platform_credentials IS 'Encrypted platform-wide service credentials (admin vault)';
COMMENT ON TABLE credential_audit_log IS 'Audit trail for credential vault operations';
