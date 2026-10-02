-- Migration: Add SET search_path = public to SECURITY DEFINER functions
-- Security fix: prevents schema hijacking by ensuring functions always
-- resolve names in the public schema.

-- 1. cleanup_rate_limits
ALTER FUNCTION public.cleanup_rate_limits()
  SET search_path = public;

-- 2. rate_limit_check
ALTER FUNCTION public.rate_limit_check(text, integer)
  SET search_path = public;

-- 3. handle_new_user (trigger function)
ALTER FUNCTION public.handle_new_user()
  SET search_path = public;

-- 4. rollup_usage_summaries
ALTER FUNCTION public.rollup_usage_summaries(text, integer)
  SET search_path = public;

-- 5. user_org_ids
ALTER FUNCTION public.user_org_ids()
  SET search_path = public;

-- 6. check_file_overlap
ALTER FUNCTION public.check_file_overlap(uuid, uuid)
  SET search_path = public;

-- 7. Drop exec_sql — arbitrary SQL execution function is a critical risk.
-- If needed for tooling, it should be recreated with strict auth checks.
DROP FUNCTION IF EXISTS public.exec_sql(text);
