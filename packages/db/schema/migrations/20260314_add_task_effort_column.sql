-- Add effort column to tasks (S = Small, M = Medium, L = Large)
-- This was defined in migration 019 but never applied to the database.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS effort text
  CHECK (effort IN ('S', 'M', 'L'));

COMMENT ON COLUMN tasks.effort IS 'Estimated effort: S (<15 min), M (15-60 min), L (1+ hours)';
