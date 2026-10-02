-- Migration: Add SET search_path = public to remaining SECURITY DEFINER functions
-- Follow-up to 20260318_security_definer_search_path.sql which missed user_workspace_ids.
-- Security fix: prevents search_path hijacking on SECURITY DEFINER functions.

-- 1. user_workspace_ids(uuid)
-- Created in 029_workspace_memberships_and_rls.sql without SET search_path.
-- Used in RLS policies on tasks, projects, activity_log — critical for tenant isolation.
ALTER FUNCTION public.user_workspace_ids(uuid)
  SET search_path = public;
