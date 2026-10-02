-- Add success_criteria jsonb column for machine-readable completion contracts
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS success_criteria jsonb DEFAULT NULL;
