-- Gate account creation behind feature flag + access codes with tier
-- When signup_gated flag is enabled, users must have an access code to create an account

-- 1. Feature flag
INSERT INTO feature_flags (key, name, description, flag_type, enabled, tags)
VALUES ('signup_gated', 'Gate Account Creation', 'When enabled, hides signup buttons and requires an access code to create an account. Login still works for existing users.', 'boolean', true, ARRAY['launch', 'auth'])
ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, description = EXCLUDED.description;

-- 2. Add plan/tier column to access_codes so Eric can control what tier each code grants
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'builder'
  CHECK (plan IN ('builder', 'pro', 'unlimited'));

-- Rollback:
-- DELETE FROM feature_flags WHERE key = 'signup_gated';
-- ALTER TABLE access_codes DROP COLUMN IF EXISTS plan;
