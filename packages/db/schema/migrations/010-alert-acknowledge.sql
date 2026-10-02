-- Add acknowledged_at column to activity_log for dismissing alerts
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz DEFAULT NULL;
