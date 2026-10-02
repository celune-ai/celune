-- 005-cron-jobs.sql
-- Tracks scheduled job health for the RICK cron registry.
-- Each launchd job writes a row here on start and finish.
-- Static metadata (display_name, schedule_description) is also stored here
-- so the admin dashboard can display it without needing a config file.
-- Run in: Supabase Dashboard → SQL Editor → New Query

CREATE TABLE cron_jobs (
  job_id              text PRIMARY KEY,
  display_name        text NOT NULL,
  schedule_description text NOT NULL,
  schedule_seconds    integer,            -- null for calendar-based or persistent jobs
  last_run_at         timestamptz,
  last_run_status     text CHECK (last_run_status IN ('running', 'success', 'failure')),
  last_error          text,               -- populated on failure, cleared on success
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cron_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cron_jobs_select" ON cron_jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY "cron_jobs_insert" ON cron_jobs FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "cron_jobs_update" ON cron_jobs FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE TRIGGER cron_jobs_updated_at
  BEFORE UPDATE ON cron_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed rows for all known jobs so the dashboard shows them even before first run
INSERT INTO cron_jobs (job_id, display_name, schedule_description, schedule_seconds) VALUES
  ('heartbeat',   'Heartbeat',       'every 30 min',      1800),
  ('dailybrief',  'Daily Brief',     'daily at 8:00 AM',  NULL),
  ('feedscanner', 'Feed Scanner',    'every 2 hours',     7200),
  ('reindex',     'Memory Reindex',  'daily at 11:00 PM', NULL),
  ('slackbot',    'Slack Bot',       'persistent',        NULL)
ON CONFLICT (job_id) DO NOTHING;
