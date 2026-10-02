-- ─────────────────────────────────────────────────────────────────────────────
-- Encrypt Slack Incoming Webhook URLs at rest
-- Security Hardening — Audit Remediation (task a63405bb)
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds encrypted_webhook_url + webhook_iv columns alongside existing
-- incoming_webhook_url. The app layer encrypts with AES-256-GCM using
-- PROVIDER_KEY_ENCRYPTION_KEY (same pattern as provider_keys table).
--
-- Migration strategy:
--   1. Add new columns (nullable for now)
--   2. App code writes encrypted values on new connections + reads encrypted
--   3. Backfill script encrypts existing plaintext rows
--   4. Future migration drops incoming_webhook_url after backfill verified
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add encrypted columns
ALTER TABLE public.slack_connections
  ADD COLUMN IF NOT EXISTS encrypted_webhook_url TEXT,
  ADD COLUMN IF NOT EXISTS webhook_iv TEXT;

COMMENT ON COLUMN public.slack_connections.encrypted_webhook_url IS
  'AES-256-GCM encrypted webhook URL. Format: "v1:<base64(ciphertext+authTag)>". Decrypted server-side only.';
COMMENT ON COLUMN public.slack_connections.webhook_iv IS
  'Base64-encoded 12-byte IV for AES-256-GCM decryption of encrypted_webhook_url.';

-- 2. Revoke direct SELECT on secret columns from authenticated role.
--    Service role (used by API routes) retains full access.
--    RLS policies already gate row-level access; this adds column-level defense.
REVOKE SELECT (incoming_webhook_url, encrypted_webhook_url, webhook_iv)
  ON public.slack_connections FROM authenticated;
