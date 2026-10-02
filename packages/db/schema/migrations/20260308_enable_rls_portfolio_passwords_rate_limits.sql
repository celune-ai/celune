-- Enable RLS on tables that were missing it.
-- No USING policies needed: service role (used by all API routes) bypasses RLS.
-- Default deny blocks any direct user-context access via anon key.

ALTER TABLE portfolio_passwords ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Rollback:
-- ALTER TABLE portfolio_passwords DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE rate_limits DISABLE ROW LEVEL SECURITY;
