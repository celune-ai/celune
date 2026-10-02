-- Migration: Fix misconfigured RLS policies
--
-- Critical findings from security audit 2026-03-28:
-- 1. portfolio_passwords: policy "Service role full access" granted PUBLIC (anonymous) access
-- 2. workspace_github_tokens: policy "Service role full access" granted PUBLIC access (redundant with proper service_all)
-- 3. heartbeat_events: authenticated SELECT USING(true) leaked cross-workspace data
--
-- Already applied to production via execute_sql. This migration file is for the record.

-- FIX 1: portfolio_passwords — drop public-access policy, add proper service_role + workspace-scoped
DROP POLICY IF EXISTS "Service role full access to portfolio_passwords" ON portfolio_passwords;

CREATE POLICY "portfolio_passwords_service_all" ON portfolio_passwords
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "portfolio_passwords_select_workspace" ON portfolio_passwords
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

-- FIX 2: workspace_github_tokens — drop dangling public-access policy
-- (workspace_github_tokens_service_all already provides correct service_role access)
DROP POLICY IF EXISTS "Service role full access" ON workspace_github_tokens;

-- FIX 3: heartbeat_events — scope SELECT to user's workspaces
DROP POLICY IF EXISTS "heartbeat_events_select" ON heartbeat_events;

CREATE POLICY "heartbeat_events_select_workspace" ON heartbeat_events
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IS NULL
    OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );
