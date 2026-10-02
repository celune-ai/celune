-- Tighten claude_usage RLS: remove overly permissive anon read policy.
-- All access goes through service_role via API routes; anon should not
-- have blanket read access to usage/cost data.
--
-- Rollback: CREATE POLICY "Anon read-only on claude_usage" ON claude_usage FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Anon read-only on claude_usage" ON claude_usage;

-- Add user_id column if not already present (some deploys may have it)
ALTER TABLE claude_usage ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- Add user-scoped read policy: authenticated users can only see their own usage
CREATE POLICY "Authenticated users read own claude_usage"
  ON claude_usage
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
