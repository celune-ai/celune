-- Add base_content column to brain_content table
-- Stores the CORE version at the time of fork, enabling true three-way merge.
-- When a user resolves a merge, the new CORE version becomes the base_content.
-- Falls back to two-way comparison if base_content is NULL.

ALTER TABLE IF EXISTS brain_content
  ADD COLUMN IF NOT EXISTS base_content TEXT;

DO $$
BEGIN
  IF to_regclass('public.brain_content') IS NOT NULL THEN
    COMMENT ON COLUMN brain_content.base_content IS 'CORE version at fork time — used as base for three-way section merge';
  END IF;
END $$;
