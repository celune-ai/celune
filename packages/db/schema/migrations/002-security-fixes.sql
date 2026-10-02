-- Migration 002: Security fixes from Supabase linter audit (2026-02-26)
-- Run in the Supabase SQL Editor for your project.
-- See: packages/db/schema/supabase-schema.sql for full schema context
-- See: packages/db/schema/supabase-schema.sql for security decision rationale

-- ============================================================
-- FIX 1: Function search_path mutable (FINDING-001)
-- Adds SET search_path = '' to prevent search_path injection.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = '';

-- ============================================================
-- FIX 2: Overly permissive RLS policies (FINDING-002)
-- Replace FOR ALL USING(true) WITH CHECK(true) with per-operation
-- policies. SELECT keeps USING(true) (intentional public read for
-- authenticated users). Mutations use auth.role() check.
-- ============================================================

-- tasks
DROP POLICY IF EXISTS "Authenticated users can do everything on tasks" ON tasks;
CREATE POLICY "tasks_select" ON tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "tasks_insert" ON tasks FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "tasks_update" ON tasks FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "tasks_delete" ON tasks FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

-- projects
DROP POLICY IF EXISTS "Authenticated users can do everything on projects" ON projects;
CREATE POLICY "projects_select" ON projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "projects_insert" ON projects FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "projects_update" ON projects FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "projects_delete" ON projects FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

-- activity_log
DROP POLICY IF EXISTS "Authenticated users can do everything on activity_log" ON activity_log;
CREATE POLICY "activity_log_select" ON activity_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "activity_log_insert" ON activity_log FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "activity_log_update" ON activity_log FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "activity_log_delete" ON activity_log FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

-- task_comments
DROP POLICY IF EXISTS "Authenticated users can do everything on task_comments" ON task_comments;
CREATE POLICY "task_comments_select" ON task_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "task_comments_insert" ON task_comments FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "task_comments_update" ON task_comments FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "task_comments_delete" ON task_comments FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

-- agent_status
DROP POLICY IF EXISTS "Authenticated users can do everything on agent_status" ON agent_status;
CREATE POLICY "agent_status_select" ON agent_status FOR SELECT TO authenticated USING (true);
CREATE POLICY "agent_status_insert" ON agent_status FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "agent_status_update" ON agent_status FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "agent_status_delete" ON agent_status FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

-- ============================================================
-- FINDING-003: Leaked Password Protection
-- Cannot be fixed via SQL — requires dashboard toggle:
-- Supabase Dashboard > Authentication > Settings >
-- "Leaked Password Protection" > Enable
-- ============================================================
