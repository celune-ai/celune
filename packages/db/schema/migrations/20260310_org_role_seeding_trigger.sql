-- Permissions Sprint 1, Task 3: Org role seeding trigger
-- Automatically provisions 4 default roles for new organizations
-- and seeds their role_permissions from system defaults.

-- ============================================
-- 1. seed_org_roles() function
-- ============================================
-- Triggered AFTER INSERT on organizations.
-- Creates org-scoped copies of the 4 standard roles (Viewer, Member, Admin, Owner)
-- and copies role_permissions from the corresponding system roles.

CREATE OR REPLACE FUNCTION seed_org_roles()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_system_role RECORD;
  v_new_role_id uuid;
BEGIN
  -- Loop through the 4 standard system roles
  FOR v_system_role IN
    SELECT id, name, slug, description
    FROM roles
    WHERE is_system = true
      AND org_id IS NULL
      AND slug IN ('viewer', 'member', 'admin', 'owner')
    ORDER BY slug
  LOOP
    -- Create org-scoped role
    INSERT INTO roles (name, slug, description, org_id, is_system)
    VALUES (
      v_system_role.name,
      v_system_role.slug,
      v_system_role.description,
      NEW.id,
      false  -- org-scoped roles are not system roles
    )
    ON CONFLICT (slug, org_id) DO NOTHING
    RETURNING id INTO v_new_role_id;

    -- If role was created (not already existing), seed its permissions
    IF v_new_role_id IS NOT NULL THEN
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT v_new_role_id, rp.permission_id
      FROM role_permissions rp
      WHERE rp.role_id = v_system_role.id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;


-- ============================================
-- 2. Trigger on organizations table
-- ============================================

DROP TRIGGER IF EXISTS trg_seed_org_roles ON organizations;

CREATE TRIGGER trg_seed_org_roles
  AFTER INSERT ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION seed_org_roles();


-- ============================================
-- 3. Backfill: seed roles for existing orgs
-- ============================================
-- Insert roles for any existing organizations that don't have them yet.

DO $$
DECLARE
  v_org RECORD;
  v_system_role RECORD;
  v_new_role_id uuid;
BEGIN
  FOR v_org IN
    SELECT id FROM organizations
    WHERE id NOT IN (
      SELECT DISTINCT org_id FROM roles WHERE org_id IS NOT NULL
    )
  LOOP
    FOR v_system_role IN
      SELECT id, name, slug, description
      FROM roles
      WHERE is_system = true
        AND org_id IS NULL
        AND slug IN ('viewer', 'member', 'admin', 'owner')
      ORDER BY slug
    LOOP
      INSERT INTO roles (name, slug, description, org_id, is_system)
      VALUES (
        v_system_role.name,
        v_system_role.slug,
        v_system_role.description,
        v_org.id,
        false
      )
      ON CONFLICT (slug, org_id) DO NOTHING
      RETURNING id INTO v_new_role_id;

      IF v_new_role_id IS NOT NULL THEN
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT v_new_role_id, rp.permission_id
        FROM role_permissions rp
        WHERE rp.role_id = v_system_role.id;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- From 20260310_cr_fixes_rpc_scoping_rls.sql (sorts before this file).
REVOKE ALL ON FUNCTION seed_org_roles() FROM PUBLIC;
