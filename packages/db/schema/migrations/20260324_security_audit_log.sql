-- SOC 2 Immutable Security Audit Log
-- Separate from activity_log: append-only, no UPDATE/DELETE for non-service roles.
-- Covers CC6.1 (logical access), CC7.2 (system monitoring), CC8.1 (change management).

-- Event type enum for structured querying
DO $$ BEGIN
  CREATE TYPE security_event_type AS ENUM (
    'auth.login',
    'auth.login_failed',
    'auth.logout',
    'auth.token_refresh',
    'auth.password_change',
    'auth.mfa_enable',
    'auth.mfa_disable',
    'admin.role_change',
    'admin.permission_change',
    'admin.user_invite',
    'admin.user_remove',
    'admin.workspace_create',
    'admin.workspace_delete',
    'apikey.create',
    'apikey.rotate',
    'apikey.delete',
    'apikey.validate',
    'provider_key.create',
    'provider_key.rotate',
    'provider_key.delete',
    'provider_key.decrypt',
    'data.export',
    'data.delete',
    'data.bulk_operation',
    'config.change',
    'security.rate_limit_exceeded',
    'security.csrf_violation',
    'security.unauthorized_access'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Severity enum
DO $$ BEGIN
  CREATE TYPE security_severity AS ENUM ('info', 'warning', 'error', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Main table
CREATE TABLE IF NOT EXISTS security_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type security_event_type NOT NULL,
  severity security_severity NOT NULL DEFAULT 'info',
  actor_id UUID REFERENCES auth.users(id),
  actor_email TEXT,
  target_type TEXT,
  target_id TEXT,
  workspace_id UUID REFERENCES workspaces(id),
  ip_address INET,
  user_agent TEXT,
  details JSONB DEFAULT '{}',
  retain_until TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 years'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_sal_workspace_created
  ON security_audit_log(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sal_event_type
  ON security_audit_log(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sal_actor
  ON security_audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sal_severity
  ON security_audit_log(severity) WHERE severity IN ('error', 'critical');

-- RLS: workspace members can SELECT their own workspace logs
ALTER TABLE security_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY sal_select_workspace ON security_audit_log
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_memberships
      WHERE user_id = auth.uid()
    )
  );

-- INSERT only via service role (application code)
-- No UPDATE or DELETE policies = immutable for non-service roles
CREATE POLICY sal_insert_service ON security_audit_log
  FOR INSERT TO service_role
  WITH CHECK (true);

-- Rollback: DROP TABLE security_audit_log; DROP TYPE security_event_type; DROP TYPE security_severity;
