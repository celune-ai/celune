-- Device Authorization Flow (RFC 8628-style)
-- Replaces cli_setup_tokens with a more secure device auth pattern.
-- CLI generates a device_code + user_code, user confirms in browser.

CREATE TABLE IF NOT EXISTS device_auth_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code   text NOT NULL UNIQUE,        -- 256-bit secret, CLI keeps this
  user_code     text NOT NULL UNIQUE,         -- Short human-readable (e.g. ABCD-1234)
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,  -- Set on verify
  workspace_id  uuid REFERENCES workspaces(id) ON DELETE CASCADE,  -- Set on verify
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'authorized', 'expired', 'used')),
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  authorized_at timestamptz,
  used_at       timestamptz,
  client_ip     text                          -- CLI IP for audit trail
);

-- Index for CLI polling (looks up by device_code)
CREATE INDEX IF NOT EXISTS idx_device_auth_codes_device_code
  ON device_auth_codes (device_code) WHERE status IN ('pending', 'authorized');

-- Index for browser verification (looks up by user_code)
CREATE INDEX IF NOT EXISTS idx_device_auth_codes_user_code
  ON device_auth_codes (user_code) WHERE status = 'pending';

-- Auto-expire old codes (cleanup cron can use this)
CREATE INDEX IF NOT EXISTS idx_device_auth_codes_expires_at
  ON device_auth_codes (expires_at) WHERE status = 'pending';

-- RLS: Only service role accesses this table (no user-facing RLS needed)
ALTER TABLE device_auth_codes ENABLE ROW LEVEL SECURITY;

-- Service role bypass (API routes use createServiceClient)
CREATE POLICY device_auth_codes_service_all ON device_auth_codes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
