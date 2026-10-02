-- Fix check_memory_quota() AND set_memory_ttl() triggers that both referenced
-- a non-existent "subscriptions" table. This was blocking ALL agent_memory inserts
-- during onboarding chat, which caused generate-projects to find 0 memories → 400.
-- Replaced with simple defaults — app-level plan enforcement handles gating
-- via resolveWorkspacePlan().

-- Fix 1: check_memory_quota() — default 500 memory limit
CREATE OR REPLACE FUNCTION public.check_memory_quota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan text;
  v_count integer;
  v_limit integer;
BEGIN
  v_plan := 'build';
  v_limit := 500;

  SELECT COUNT(*) INTO v_count
  FROM agent_memory
  WHERE user_id = NEW.user_id;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'Memory quota exceeded: % of % memories (plan: %). Upgrade your plan or delete old memories.',
      v_count, v_limit, v_plan;
  END IF;

  RETURN NEW;
END;
$function$;

-- Fix 2: set_memory_ttl() — default 1 year TTL
CREATE OR REPLACE FUNCTION public.set_memory_ttl()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan text;
BEGIN
  IF NEW.expires_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_plan := 'build';

  NEW.expires_at := CASE v_plan
    WHEN 'free' THEN now() + interval '30 days'
    WHEN 'build' THEN now() + interval '1 year'
    WHEN 'pro' THEN now() + interval '1 year'
    WHEN 'team' THEN NULL
    ELSE now() + interval '1 year'
  END;

  RETURN NEW;
END;
$function$;
