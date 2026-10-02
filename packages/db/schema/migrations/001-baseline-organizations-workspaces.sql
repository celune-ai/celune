-- Migration 001: baseline for the tenancy tables that every later migration assumes.
--
-- organizations, org_memberships, workspaces and user_preferences were created by
-- hand in the hosted project before migration tracking existed. This file
-- reconstructs them from the hosted schema (pg_catalog read on 2026-09-26) so a
-- fresh database can be booted from supabase-schema.sql plus this directory alone.
--
-- Only the original shape is defined here. Columns, indexes and policies that a
-- later migration adds (repo_url, status, parent_workspace_id, trial budget, ...)
-- stay in those migrations. Helper functions are defined in their legacy form;
-- 20260306_rbac_v2_rls_permission_functions.sql replaces them with the RBAC v2
-- versions.
--
-- The numeric prefix is deliberate: 028 and 029 reference these tables, so this
-- file has to sort before them. Every other new migration uses the date prefix.
--
-- On a database that already has these tables (the hosted project), the guard below
-- stops the file before it can replace the RBAC v2 helper functions and policies.
-- scripts/migrate.mjs treats the "already exists" error as applied and records it.

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NOT NULL THEN
    RAISE EXCEPTION 'relation "organizations" already exists; baseline 001 is for empty databases only';
  END IF;
END $$;

-- ============================================================
-- _migrations (tracking table used by scripts/migrate.mjs; 20260326 enables RLS on it)
-- ============================================================

CREATE TABLE IF NOT EXISTS public._migrations (
  id         serial PRIMARY KEY,
  filename   text NOT NULL UNIQUE,
  hash       text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL DEFAULT 'rick'
);

-- ============================================================
-- organizations
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  owner_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  logo_url   text,
  metadata   jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organizations_owner ON public.organizations (owner_id);
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON public.organizations (slug);

CREATE OR REPLACE FUNCTION public.update_organizations_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS organizations_updated_at ON public.organizations;
CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_organizations_updated_at();

-- tasks.org_id arrives in 021; plpgsql resolves the column at run time.
CREATE OR REPLACE FUNCTION public.prevent_org_deletion()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  task_count integer;
  workspace_count integer;
BEGIN
  SELECT count(*) INTO task_count FROM tasks WHERE org_id = OLD.id;
  SELECT count(*) INTO workspace_count FROM workspaces WHERE org_id = OLD.id;

  IF task_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete organization with % tasks. Transfer or delete tasks first.', task_count;
  END IF;

  IF workspace_count > 1 THEN
    RAISE EXCEPTION 'Cannot delete organization with % workspaces. Delete workspaces first.', workspace_count;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS guard_org_deletion ON public.organizations;
CREATE TRIGGER guard_org_deletion
  BEFORE DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_org_deletion();

-- ============================================================
-- org_memberships (legacy org roles; RBAC v2 adds org_members in 20260306)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.org_memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member'
             CONSTRAINT org_memberships_role_check CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_memberships_org ON public.org_memberships (org_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_org_role ON public.org_memberships (org_id, role);
CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON public.org_memberships (user_id);

CREATE OR REPLACE FUNCTION public.update_org_memberships_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS org_memberships_updated_at ON public.org_memberships;
CREATE TRIGGER org_memberships_updated_at
  BEFORE UPDATE ON public.org_memberships
  FOR EACH ROW EXECUTE FUNCTION public.update_org_memberships_updated_at();

-- ============================================================
-- Legacy RLS helpers (SECURITY DEFINER so policies avoid self-recursion)
-- ============================================================

CREATE OR REPLACE FUNCTION public.user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM org_memberships WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.user_admin_org_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM org_memberships
  WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
$$;

-- ============================================================
-- workspaces
-- ============================================================

CREATE TABLE IF NOT EXISTS public.workspaces (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name         text NOT NULL,
  slug         text NOT NULL,
  description  text DEFAULT '',
  icon         text DEFAULT '🏠',
  color_scheme text DEFAULT 'default',
  is_default   boolean NOT NULL DEFAULT false,
  metadata     jsonb DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_org ON public.workspaces (org_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_org_default ON public.workspaces (org_id, is_default);

CREATE OR REPLACE FUNCTION public.update_workspaces_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS workspaces_updated_at ON public.workspaces;
CREATE TRIGGER workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.update_workspaces_updated_at();

-- ============================================================
-- user_preferences (per user, per workspace)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_preferences (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  hook_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  cli_permissions  jsonb NOT NULL DEFAULT '{"deny": [], "allow": []}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, workspace_id)
);

CREATE OR REPLACE FUNCTION public.update_user_preferences_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS set_updated_at_user_preferences ON public.user_preferences;
CREATE TRIGGER set_updated_at_user_preferences
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_user_preferences_updated_at();

-- ============================================================
-- Row level security
-- ============================================================

ALTER TABLE public.organizations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_select_member ON public.organizations;
CREATE POLICY organizations_select_member ON public.organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT org_id FROM org_memberships WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS organizations_insert_auth ON public.organizations;
CREATE POLICY organizations_insert_auth ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS organizations_update_owner ON public.organizations;
CREATE POLICY organizations_update_owner ON public.organizations
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS organizations_delete_owner ON public.organizations;
CREATE POLICY organizations_delete_owner ON public.organizations
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- 20260305_fix_org_memberships_rls_recursion.sql recreates these four with the same shape.
DROP POLICY IF EXISTS org_memberships_select_member ON public.org_memberships;
CREATE POLICY org_memberships_select_member ON public.org_memberships
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS org_memberships_insert_admin ON public.org_memberships;
CREATE POLICY org_memberships_insert_admin ON public.org_memberships
  FOR INSERT WITH CHECK (org_id IN (SELECT user_admin_org_ids()));

DROP POLICY IF EXISTS org_memberships_update_admin ON public.org_memberships;
CREATE POLICY org_memberships_update_admin ON public.org_memberships
  FOR UPDATE USING (org_id IN (SELECT user_admin_org_ids()))
  WITH CHECK (org_id IN (SELECT user_admin_org_ids()));

DROP POLICY IF EXISTS org_memberships_delete_admin ON public.org_memberships;
CREATE POLICY org_memberships_delete_admin ON public.org_memberships
  FOR DELETE USING (user_id = auth.uid() OR org_id IN (SELECT user_admin_org_ids()));

DROP POLICY IF EXISTS workspaces_select_member ON public.workspaces;
CREATE POLICY workspaces_select_member ON public.workspaces
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM org_memberships om WHERE om.user_id = auth.uid()));

DROP POLICY IF EXISTS workspaces_insert_admin ON public.workspaces;
CREATE POLICY workspaces_insert_admin ON public.workspaces
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (
    SELECT om.org_id FROM org_memberships om
    WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
  ));

DROP POLICY IF EXISTS workspaces_update_admin ON public.workspaces;
CREATE POLICY workspaces_update_admin ON public.workspaces
  FOR UPDATE TO authenticated
  USING (org_id IN (
    SELECT om.org_id FROM org_memberships om
    WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
  ))
  WITH CHECK (org_id IN (
    SELECT om.org_id FROM org_memberships om
    WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
  ));

DROP POLICY IF EXISTS workspaces_delete_owner ON public.workspaces;
CREATE POLICY workspaces_delete_owner ON public.workspaces
  FOR DELETE TO authenticated
  USING (is_default = false AND org_id IN (
    SELECT om.org_id FROM org_memberships om
    WHERE om.user_id = auth.uid() AND om.role = 'owner'
  ));

-- 20260309_workspace_rls_policies.sql adds the workspace check to this policy.
DROP POLICY IF EXISTS "Users can manage own preferences" ON public.user_preferences;
CREATE POLICY "Users can manage own preferences" ON public.user_preferences
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role full access on user_preferences" ON public.user_preferences;
CREATE POLICY "Service role full access on user_preferences" ON public.user_preferences
  FOR ALL USING (auth.role() = 'service_role');
