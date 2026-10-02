-- Rename 'free' plan tier to 'build' ($19/mo) across all tables.
-- Part of the free-tier removal: all plans are now paid.

-- 1. Update existing subscriptions
UPDATE subscriptions SET plan = 'build' WHERE plan = 'free';

-- 2. Update the column default (was DEFAULT 'free')
ALTER TABLE subscriptions ALTER COLUMN plan SET DEFAULT 'build';

-- 3. Update any workspace trial_plan references
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workspaces' AND column_name = 'trial_plan'
  ) THEN
    UPDATE workspaces SET trial_plan = 'build' WHERE trial_plan = 'free';
  END IF;
END $$;

-- 4. Update agent_memory quota function if it references 'free'
-- (The function uses COALESCE(s.plan, 'free') — needs rebuild)
CREATE OR REPLACE FUNCTION check_memory_quota()
RETURNS TRIGGER AS $$
DECLARE
  v_plan text;
  v_limit int;
  v_count int;
BEGIN
  -- Get the workspace owner's plan
  SELECT COALESCE(s.plan, 'build') INTO v_plan
  FROM workspace_memberships wm
  LEFT JOIN subscriptions s ON s.user_id = wm.user_id
  WHERE wm.workspace_id = NEW.workspace_id
    AND wm.role = 'owner'
  LIMIT 1;

  IF v_plan IS NULL THEN
    v_plan := 'build';
  END IF;

  -- Plan-based memory limits
  v_limit := CASE v_plan
    WHEN 'build' THEN 20000
    WHEN 'pro' THEN 50000
    WHEN 'team' THEN -1  -- unlimited
    WHEN 'enterprise' THEN -1
    WHEN 'platform_owner' THEN -1
    WHEN 'sponsored' THEN -1
    ELSE 20000
  END;

  -- Skip check for unlimited plans
  IF v_limit = -1 THEN
    RETURN NEW;
  END IF;

  -- Count existing memories
  SELECT COUNT(*) INTO v_count
  FROM agent_memory
  WHERE workspace_id = NEW.workspace_id;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'Memory quota exceeded for % plan (limit: %)', v_plan, v_limit;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Update memory TTL function if it references 'free'
CREATE OR REPLACE FUNCTION get_memory_ttl_days(p_workspace_id uuid)
RETURNS int AS $$
DECLARE
  v_plan text;
BEGIN
  SELECT COALESCE(s.plan, 'build') INTO v_plan
  FROM workspace_memberships wm
  LEFT JOIN subscriptions s ON s.user_id = wm.user_id
  WHERE wm.workspace_id = p_workspace_id
    AND wm.role = 'owner'
  LIMIT 1;

  IF v_plan IS NULL THEN
    v_plan := 'build';
  END IF;

  RETURN CASE v_plan
    WHEN 'build' THEN 90
    WHEN 'pro' THEN 365
    WHEN 'team' THEN -1  -- no expiry
    WHEN 'enterprise' THEN -1
    WHEN 'platform_owner' THEN -1
    WHEN 'sponsored' THEN -1
    ELSE 90
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
