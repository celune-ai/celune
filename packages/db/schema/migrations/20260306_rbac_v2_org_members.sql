-- RBAC v2: org_members table
-- Replaces org-level use of user_roles with explicit org membership + role_id FK.

CREATE TABLE org_members (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id      uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id     uuid        NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  is_owner    boolean     NOT NULL DEFAULT false,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_id)
);

CREATE UNIQUE INDEX org_members_one_owner_per_org
  ON org_members (org_id) WHERE is_owner = true;

CREATE INDEX org_members_user_id_idx ON org_members (user_id);
CREATE INDEX org_members_org_id_idx ON org_members (org_id);
CREATE INDEX org_members_role_id_idx ON org_members (role_id);

ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_select_own" ON org_members
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "org_members_select_org_staff" ON org_members
  FOR SELECT USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid()
        AND om.is_active = true
        AND (om.is_owner = true OR om.role_id IN (
          SELECT id FROM roles WHERE slug = 'admin' AND is_system = true
        ))
    )
  );

CREATE POLICY "org_members_service_all" ON org_members
  FOR ALL USING (auth.role() = 'service_role');

-- The hosted project uses this plpgsql function; the moddatetime extension is not installed.
CREATE OR REPLACE FUNCTION public.update_org_members_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_members_updated_at ON org_members;
CREATE TRIGGER org_members_updated_at
  BEFORE UPDATE ON org_members
  FOR EACH ROW
  EXECUTE FUNCTION public.update_org_members_updated_at();

-- Migrate: owner/admin from user_roles → org_members
INSERT INTO org_members (user_id, org_id, role_id, is_owner, is_active)
SELECT ur.user_id, ur.org_id,
  (SELECT id FROM roles WHERE slug = 'admin' AND is_system = true),
  ur.role = 'owner', ur.is_active
FROM user_roles ur
WHERE ur.role IN ('owner', 'admin') AND ur.org_id IS NOT NULL;
