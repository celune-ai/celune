-- Add missing index on activity_log.severity for filtered queries
-- Performance audit finding: severity filter used in alert dashboard + activity feed filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_log_severity
  ON activity_log(severity);
