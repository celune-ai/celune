-- Migration: Memory quota enforcement + TTL auto-set
-- Sprint 1, Task 4: Plan-based limits and expiration
--
-- Quota limits: spark/free=500, build/pro=10000, scale/team=100000
-- TTL defaults: spark/free=30 days, build/pro=1 year, scale/team=unlimited
--
-- Depends on: subscriptions table (user-scoped, plan column)

-- Quota enforcement trigger
CREATE OR REPLACE FUNCTION check_memory_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
  v_count integer;
  v_limit integer;
BEGIN
  -- Look up user's plan (default to 'free' if no subscription)
  SELECT COALESCE(s.plan, 'free') INTO v_plan
  FROM subscriptions s
  WHERE s.user_id = NEW.user_id
  LIMIT 1;

  IF v_plan IS NULL THEN
    v_plan := 'free';
  END IF;

  -- Map plan to memory limit
  v_limit := CASE v_plan
    WHEN 'free' THEN 500
    WHEN 'pro' THEN 10000      -- Build tier ($29)
    WHEN 'team' THEN 100000    -- Scale tier ($99)
    ELSE 500                    -- Unknown plans get free-tier limits
  END;

  -- Count existing memories for this user
  SELECT COUNT(*) INTO v_count
  FROM agent_memory
  WHERE user_id = NEW.user_id;

  -- Enforce quota
  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'Memory quota exceeded: % of % memories (plan: %). Upgrade your plan or delete old memories.',
      v_count, v_limit, v_plan;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_memory_quota_check ON agent_memory;
CREATE TRIGGER agent_memory_quota_check
  BEFORE INSERT ON agent_memory
  FOR EACH ROW
  EXECUTE FUNCTION check_memory_quota();

-- TTL auto-set trigger: sets expires_at based on plan if not explicitly provided
CREATE OR REPLACE FUNCTION set_memory_ttl()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
BEGIN
  -- Only set TTL if caller didn't provide an explicit expires_at
  IF NEW.expires_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Look up user's plan
  SELECT COALESCE(s.plan, 'free') INTO v_plan
  FROM subscriptions s
  WHERE s.user_id = NEW.user_id
  LIMIT 1;

  IF v_plan IS NULL THEN
    v_plan := 'free';
  END IF;

  -- Set TTL based on plan
  NEW.expires_at := CASE v_plan
    WHEN 'free' THEN now() + interval '30 days'
    WHEN 'pro' THEN now() + interval '1 year'
    WHEN 'team' THEN NULL  -- unlimited (Scale tier)
    ELSE now() + interval '30 days'
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_memory_ttl_set ON agent_memory;
CREATE TRIGGER agent_memory_ttl_set
  BEFORE INSERT ON agent_memory
  FOR EACH ROW
  EXECUTE FUNCTION set_memory_ttl();

-- Cleanup function: delete expired memories (run periodically via cron or edge function)
CREATE OR REPLACE FUNCTION cleanup_expired_memories()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH deleted AS (
    DELETE FROM agent_memory
    WHERE expires_at IS NOT NULL AND expires_at < now()
    RETURNING id
  )
  SELECT COUNT(*)::integer FROM deleted;
$$;
