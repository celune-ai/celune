-- Access code expiration support
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS duration text
  CHECK (duration IN ('1_week', '1_month', '3_months', '6_months', '1_year', 'unlimited'));

-- Constraint: if duration is not 'unlimited', expires_at must be set
ALTER TABLE access_codes ADD CONSTRAINT expires_consistent
  CHECK (duration IS NULL OR duration = 'unlimited' OR expires_at IS NOT NULL);

-- Rollback:
-- ALTER TABLE access_codes DROP CONSTRAINT IF EXISTS expires_consistent;
-- ALTER TABLE access_codes DROP COLUMN IF EXISTS expires_at;
-- ALTER TABLE access_codes DROP COLUMN IF EXISTS duration;
