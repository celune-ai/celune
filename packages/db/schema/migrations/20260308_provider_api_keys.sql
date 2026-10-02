-- BYOK: Provider API Keys
-- Stores user/org-provided API keys for third-party AI providers.
-- Keys are encrypted at the application layer using AES-256-GCM.
-- Only key_suffix (last 4 chars) is exposed through RLS; encrypted_key
-- is never readable by authenticated clients — service_role only.

CREATE TABLE IF NOT EXISTS provider_api_keys (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id            uuid        REFERENCES workspaces(id) ON DELETE CASCADE,  -- NULL = org-wide key
  user_id                 uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider                text        NOT NULL CHECK (provider IN ('anthropic', 'openai', 'elevenlabs', 'groq')),
  name                    text,                          -- user-friendly label e.g. "My Claude Key"
  encrypted_key           text        NOT NULL,          -- AES-256-GCM ciphertext (hex or base64)
  key_iv                  text        NOT NULL,          -- AES-256-GCM initialization vector
  key_suffix              text,                          -- last 4 chars of plaintext, for display: "...abc1"
  is_active               boolean     NOT NULL DEFAULT true,
  last_used_at            timestamptz,
  last_validated_at       timestamptz,
  last_validation_status  text        CHECK (last_validation_status IN ('valid', 'invalid', 'error')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_provider_api_keys_org
  ON provider_api_keys (org_id);

CREATE INDEX IF NOT EXISTS idx_provider_api_keys_workspace
  ON provider_api_keys (workspace_id) WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_api_keys_user
  ON provider_api_keys (user_id);

-- One active key per provider per workspace (org-scoped keys use NULL workspace_id).
-- Partial unique index: enforces uniqueness among active keys only.
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_api_keys_one_active_per_workspace
  ON provider_api_keys (org_id, workspace_id, provider)
  WHERE is_active = true AND workspace_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_api_keys_one_active_org_wide
  ON provider_api_keys (org_id, provider)
  WHERE is_active = true AND workspace_id IS NULL;

-- ============================================
-- RLS
-- ============================================

ALTER TABLE provider_api_keys ENABLE ROW LEVEL SECURITY;

-- Service role has full unrestricted access (for encryption/decryption at application layer).
CREATE POLICY "provider_api_keys_service_all" ON provider_api_keys
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Org members can SELECT key metadata (id, org_id, workspace_id, user_id, provider, name,
-- key_suffix, is_active, last_used_at, last_validated_at, last_validation_status,
-- created_at, updated_at). encrypted_key and key_iv are NOT exposed here — the policy
-- grants row-level access but column security is enforced by NOT granting SELECT on
-- encrypted_key/key_iv to the authenticated role (see column privilege revocation below).
CREATE POLICY "provider_api_keys_org_members_select" ON provider_api_keys
  FOR SELECT TO authenticated
  USING (
    org_id IN (
      SELECT om.org_id
      FROM org_members om
      WHERE om.user_id = auth.uid()
        AND om.is_active = true
    )
  );

-- Org owners and admins can INSERT keys in their org.
CREATE POLICY "provider_api_keys_org_admins_insert" ON provider_api_keys
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (
      SELECT om.org_id
      FROM org_members om
      WHERE om.user_id = auth.uid()
        AND om.is_active = true
        AND (
          om.is_owner = true
          OR om.role_id IN (
            SELECT id FROM roles WHERE slug IN ('admin') AND is_system = true
          )
        )
    )
  );

-- Org owners and admins can UPDATE keys in their org.
CREATE POLICY "provider_api_keys_org_admins_update" ON provider_api_keys
  FOR UPDATE TO authenticated
  USING (
    org_id IN (
      SELECT om.org_id
      FROM org_members om
      WHERE om.user_id = auth.uid()
        AND om.is_active = true
        AND (
          om.is_owner = true
          OR om.role_id IN (
            SELECT id FROM roles WHERE slug IN ('admin') AND is_system = true
          )
        )
    )
  );

-- Org owners and admins can DELETE keys in their org.
CREATE POLICY "provider_api_keys_org_admins_delete" ON provider_api_keys
  FOR DELETE TO authenticated
  USING (
    org_id IN (
      SELECT om.org_id
      FROM org_members om
      WHERE om.user_id = auth.uid()
        AND om.is_active = true
        AND (
          om.is_owner = true
          OR om.role_id IN (
            SELECT id FROM roles WHERE slug IN ('admin') AND is_system = true
          )
        )
    )
  );

-- ============================================
-- Column-level security: hide encrypted_key and key_iv from authenticated role
-- ============================================
-- Revoke SELECT on sensitive columns so even rows visible under RLS
-- do not leak the ciphertext or IV to client requests.

REVOKE SELECT (encrypted_key, key_iv) ON provider_api_keys FROM authenticated;

-- ============================================
-- updated_at trigger
-- ============================================

CREATE OR REPLACE TRIGGER provider_api_keys_updated_at
  BEFORE UPDATE ON provider_api_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Rollback:
-- DROP TRIGGER IF EXISTS provider_api_keys_updated_at ON provider_api_keys;
-- DROP INDEX IF EXISTS idx_provider_api_keys_one_active_org_wide;
-- DROP INDEX IF EXISTS idx_provider_api_keys_one_active_per_workspace;
-- DROP INDEX IF EXISTS idx_provider_api_keys_user;
-- DROP INDEX IF EXISTS idx_provider_api_keys_workspace;
-- DROP INDEX IF EXISTS idx_provider_api_keys_org;
-- DROP TABLE IF EXISTS provider_api_keys;
-- ============================================
