-- RBAC v2: Single-call permission resolution RPC
-- Replaces 4-6 sequential queries in resolvePermissions() with one database round-trip.
-- Returns: is_platform_owner, is_owner, is_active, role_slug, permission_keys[]

CREATE OR REPLACE FUNCTION resolve_user_permissions(
  p_user_id uuid,
  p_workspace_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
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

  -- Step 1b: No workspace context → legacy role fallback
  IF p_workspace_id IS NULL AND v_legacy_role IS NOT NULL THEN
    SELECT array_agg(p.key) INTO v_permission_keys
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    JOIN roles r ON r.id = rp.role_id
    WHERE r.slug = v_legacy_role AND r.is_system = true;

    RETURN jsonb_build_object(
      'is_platform_owner', false,
      'is_owner', false,
      'is_active', true,
      'role_slug', v_legacy_role,
      'permission_keys', COALESCE(to_jsonb(v_permission_keys), '[]'::jsonb)
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
      -- Deactivated org member → deny
      IF v_is_active = false THEN
        RETURN jsonb_build_object(
          'is_platform_owner', false,
          'is_owner', false,
          'is_active', false,
          'role_slug', null,
          'permission_keys', '[]'::jsonb
        );
      END IF;

      -- Org owner → all permissions
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

      -- Org-level role → check role_permissions
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
