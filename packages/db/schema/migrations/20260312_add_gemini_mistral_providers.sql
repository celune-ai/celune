-- Add google_gemini and mistral to provider_api_keys provider CHECK constraint
-- Rollback: re-run with only the original 4 values

ALTER TABLE provider_api_keys
  DROP CONSTRAINT IF EXISTS provider_api_keys_provider_check;

ALTER TABLE provider_api_keys
  ADD CONSTRAINT provider_api_keys_provider_check
  CHECK (provider IN ('anthropic', 'openai', 'elevenlabs', 'groq', 'google_gemini', 'mistral'));
