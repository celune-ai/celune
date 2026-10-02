-- Encrypt GitHub installation tokens at rest
-- Adds AES-256-GCM encrypted columns, makes plaintext token nullable for migration.
-- Applied 2026-03-10

ALTER TABLE workspace_github_tokens
ADD COLUMN IF NOT EXISTS encrypted_token text,
ADD COLUMN IF NOT EXISTS token_iv text;

-- Make plaintext token nullable (will be dropped in a future migration after backfill)
ALTER TABLE workspace_github_tokens
ALTER COLUMN token DROP NOT NULL;

-- Add a comment explaining the encryption scheme
COMMENT ON COLUMN workspace_github_tokens.encrypted_token IS 'AES-256-GCM encrypted token: base64(ciphertext + authTag)';
COMMENT ON COLUMN workspace_github_tokens.token_iv IS 'AES-256-GCM IV: base64(12 random bytes)';
COMMENT ON COLUMN workspace_github_tokens.token IS 'Deprecated plaintext token — use encrypted_token + token_iv instead';
