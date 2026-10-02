-- Enterprise audit log extensions
-- Adds ip_address, before/after state, resource tracking for mutation auditing

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'activity_log' AND column_name = 'ip_address') THEN
    ALTER TABLE activity_log ADD COLUMN ip_address INET;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'activity_log' AND column_name = 'before_state') THEN
    ALTER TABLE activity_log ADD COLUMN before_state JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'activity_log' AND column_name = 'after_state') THEN
    ALTER TABLE activity_log ADD COLUMN after_state JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'activity_log' AND column_name = 'resource_type') THEN
    ALTER TABLE activity_log ADD COLUMN resource_type TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'activity_log' AND column_name = 'resource_id') THEN
    ALTER TABLE activity_log ADD COLUMN resource_id TEXT;
  END IF;
END $$;

-- Index for audit log queries
CREATE INDEX IF NOT EXISTS idx_activity_log_resource
  ON activity_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_actor
  ON activity_log(actor_user_id, created_at DESC);
