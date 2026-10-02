ALTER TABLE tasks ADD COLUMN IF NOT EXISTS outcome text;
COMMENT ON COLUMN tasks.outcome IS 'Post-completion outcome/results summary (markdown)';
