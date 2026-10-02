-- Permissions without a workspace no longer leak across orgs.
--
-- resolve_user_permissions(user, NULL) returned every permission when the user
-- owned ANY org, and otherwise the permissions of their legacy user_roles role.
-- Every account owns the org the signup trigger creates for it, so in practice
-- every user held every permission on each route that checked without a
-- workspace. With no workspace it now grants nothing except to the platform owner
-- (user_roles.role = 'owner', see 20260928_platform_owner_marker.sql).
--
-- resolve_user_org_permissions(user, org) is the org-scoped check for routes that
-- act on an org rather than a workspace: the platform owner gets every
-- permission; an active org owner gets every permission in that org; an active
-- member gets their role's permissions in that org; anyone else gets none.
--
-- Idempotent. Only the service role may execute the new function, matching
-- 20260927_revoke_user_execute_on_definer_rpcs.sql.

CREATE OR REPLACE FUNCTION public.resolve_user_permissions(p_user_id uuid, p_workspace_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_legacy_role    text;
  v_legacy_active  boolean;
  v_org_id         uuid;
  v_is_owner       boolean := false;
  v_is_active      boolean;
  v_role_id        uuid;
  v_role_slug      text;
  v_permission_keys text[];
BEGIN
  -- Step 1: Platform admin check (legacy user_roles bridge)
  SELECT role, is_active INTO v_legacy_role, v_legacy_active
  FROM user_roles
  WHERE user_id = p_user_id
  LIMIT 1;

  -- Deactivated user → deny all
  IF v_legacy_active = false THEN
    RETURN jsonb_build_object(
      'is_platform_owner', false,
      'is_owner', false,
      'is_active', false,
      'role_slug', null,
      'permission_keys', '[]'::jsonb
    );
  END IF;

  -- Platform admin (owner in user_roles) → grant all
  IF v_legacy_role = 'owner' THEN
    RETURN jsonb_build_object(
      'is_platform_owner', true,
      'is_owner', true,
      'is_active', true,
      'role_slug', null,
      'permission_keys', (
        SELECT jsonb_agg(key) FROM permissions
      )
    );
  END IF;

  -- Step 1b: No workspace context. Only the platform owner (handled above) holds
  -- permissions without a workspace. Org-level checks use resolve_user_org_permissions.
  IF p_workspace_id IS NULL THEN
    RETURN jsonb_build_object(
      'is_platform_owner', false,
      'is_owner', false,
      'is_active', true,
      'role_slug', null,
      'permission_keys', '[]'::jsonb
    );
  END IF;

  -- Step 2: Resolve workspace → org_id
  IF p_workspace_id IS NOT NULL THEN
    SELECT org_id INTO v_org_id
    FROM workspaces
    WHERE id = p_workspace_id;
  END IF;

  -- Step 3: Org membership check
  IF v_org_id IS NOT NULL THEN
    SELECT om.role_id, om.is_owner, om.is_active
    INTO v_role_id, v_is_owner, v_is_active
    FROM org_members om
    WHERE om.user_id = p_user_id AND om.org_id = v_org_id;

    IF FOUND THEN
      IF v_is_active = false THEN
        RETURN jsonb_build_object(
          'is_platform_owner', false,
          'is_owner', false,
          'is_active', false,
          'role_slug', null,
          'permission_keys', '[]'::jsonb
        );
      END IF;

      IF v_is_owner THEN
        SELECT r.slug INTO v_role_slug FROM roles r WHERE r.id = v_role_id;
        RETURN jsonb_build_object(
          'is_platform_owner', false,
          'is_owner', true,
          'is_active', true,
          'role_slug', v_role_slug,
          'permission_keys', (
            SELECT jsonb_agg(key) FROM permissions
          )
        );
      END IF;

      IF v_role_id IS NOT NULL THEN
        SELECT r.slug INTO v_role_slug FROM roles r WHERE r.id = v_role_id;
        SELECT array_agg(p.key) INTO v_permission_keys
        FROM role_permissions rp
        JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = v_role_id;

        IF v_permission_keys IS NOT NULL AND array_length(v_permission_keys, 1) > 0 THEN
          RETURN jsonb_build_object(
            'is_platform_owner', false,
            'is_owner', false,
            'is_active', true,
            'role_slug', v_role_slug,
            'permission_keys', to_jsonb(v_permission_keys)
          );
        END IF;
      END IF;
    END IF;
  END IF;

  -- Step 4: Workspace-level membership
  IF p_workspace_id IS NOT NULL THEN
    SELECT wm.role_id INTO v_role_id
    FROM workspace_memberships wm
    WHERE wm.user_id = p_user_id AND wm.workspace_id = p_workspace_id;

    IF v_role_id IS NOT NULL THEN
      SELECT r.slug INTO v_role_slug FROM roles r WHERE r.id = v_role_id;
      SELECT array_agg(p.key) INTO v_permission_keys
      FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = v_role_id;

      RETURN jsonb_build_object(
        'is_platform_owner', false,
        'is_owner', false,
        'is_active', true,
        'role_slug', v_role_slug,
        'permission_keys', COALESCE(to_jsonb(v_permission_keys), '[]'::jsonb)
      );
    END IF;
  END IF;

  -- Step 5: Default deny
  RETURN jsonb_build_object(
    'is_platform_owner', false,
    'is_owner', false,
    'is_active', true,
    'role_slug', null,
    'permission_keys', '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_user_org_permissions(p_user_id uuid, p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_legacy_role   text;
  v_legacy_active boolean;
  v_is_owner      boolean;
  v_is_active     boolean;
  v_role_id       uuid;
  v_role_slug     text;
BEGIN
  SELECT role, is_active INTO v_legacy_role, v_legacy_active
  FROM user_roles
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_legacy_active = false THEN
    RETURN jsonb_build_object(
      'is_platform_owner', false, 'is_owner', false, 'is_active', false,
      'role_slug', null, 'permission_keys', '[]'::jsonb
    );
  END IF;

  IF v_legacy_role = 'owner' THEN
    RETURN jsonb_build_object(
      'is_platform_owner', true, 'is_owner', true, 'is_active', true,
      'role_slug', null, 'permission_keys', (SELECT jsonb_agg(key) FROM permissions)
    );
  END IF;

  SELECT om.is_owner, om.is_active, om.role_id
  INTO v_is_owner, v_is_active, v_role_id
  FROM org_members om
  WHERE om.user_id = p_user_id AND om.org_id = p_org_id;

  IF NOT FOUND OR v_is_active = false THEN
    RETURN jsonb_build_object(
      'is_platform_owner', false, 'is_owner', false, 'is_active', COALESCE(v_is_active, true),
      'role_slug', null, 'permission_keys', '[]'::jsonb
    );
  END IF;

  SELECT r.slug INTO v_role_slug FROM roles r WHERE r.id = v_role_id;

  IF v_is_owner THEN
    RETURN jsonb_build_object(
      'is_platform_owner', false, 'is_owner', true, 'is_active', true,
      'role_slug', v_role_slug, 'permission_keys', (SELECT jsonb_agg(key) FROM permissions)
    );
  END IF;

  RETURN jsonb_build_object(
    'is_platform_owner', false, 'is_owner', false, 'is_active', true,
    'role_slug', v_role_slug,
    'permission_keys', COALESCE((
      SELECT jsonb_agg(p.key)
      FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = v_role_id
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_user_org_permissions(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_user_org_permissions(uuid, uuid) TO service_role;
