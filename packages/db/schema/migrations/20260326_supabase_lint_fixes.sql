-- Fix Supabase lint: security definer view + RLS on _migrations

-- 1. claude_usage_daily: SECURITY DEFINER → SECURITY INVOKER
-- The view was running with creator permissions, bypassing RLS on claude_usage.
-- Recreate with security_invoker = true so RLS applies to the querying user.
CREATE OR REPLACE VIEW public.claude_usage_daily
WITH (security_invoker = true)
AS
SELECT date_trunc('day'::text, created_at)::date AS day,
    model,
    agent_name,
    workspace_id,
    count(*) AS request_count,
    sum(input_tokens) AS total_input_tokens,
    sum(output_tokens) AS total_output_tokens,
    sum(cache_read_tokens) AS total_cache_read_tokens,
    sum(cache_creation_tokens) AS total_cache_creation_tokens,
    sum(total_cost_usd) AS total_cost_usd
FROM claude_usage
GROUP BY (date_trunc('day'::text, created_at)::date), model, agent_name, workspace_id
ORDER BY (date_trunc('day'::text, created_at)::date) DESC, (sum(total_cost_usd)) DESC;

-- 2. _migrations: enable RLS (no policies = deny all through PostgREST)
-- This table is only accessed by service role during migrations, never by end users.
ALTER TABLE public._migrations ENABLE ROW LEVEL SECURITY;

-- Rollback:
-- CREATE OR REPLACE VIEW public.claude_usage_daily AS SELECT ... (without security_invoker);
-- ALTER TABLE public._migrations DISABLE ROW LEVEL SECURITY;
