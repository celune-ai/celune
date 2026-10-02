-- Expand provider_api_keys.last_validation_status CHECK constraint
-- to include 'rate_limited' which the validation endpoint already returns.
-- Without this, re-validation crashes when a provider key is rate-limited.

-- Drop the unnamed inline CHECK constraint on last_validation_status.
-- PostgreSQL names inline CHECK constraints as "<table>_<column>_check".
ALTER TABLE provider_api_keys
  DROP CONSTRAINT IF EXISTS provider_api_keys_last_validation_status_check;

-- Re-add with expanded values
ALTER TABLE provider_api_keys
  ADD CONSTRAINT provider_api_keys_last_validation_status_check
  CHECK (last_validation_status IN ('valid', 'invalid', 'error', 'rate_limited'));

-- Rollback:
-- ALTER TABLE provider_api_keys DROP CONSTRAINT IF EXISTS provider_api_keys_last_validation_status_check;
-- ALTER TABLE provider_api_keys ADD CONSTRAINT provider_api_keys_last_validation_status_check CHECK (last_validation_status IN ('valid', 'invalid', 'error'));
