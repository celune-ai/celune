-- Platform-owner status can no longer be gained by signing up or by receiving an org.
--
-- public.resolve_user_permissions treats user_roles.role = 'owner' as the platform
-- owner and grants every permission on every workspace. That marker is kept: the
-- platform app reads the same value (lib/permissions.ts, the analytics dashboard,
-- the workspace provider), and no separate platform-owner flag exists. What changes
-- is who can hold it:
--   * handle_new_user wrote 'owner' for every self-signup, and copied invited_role
--     from raw_user_meta_data, which the signing-up client controls. A self-signup
--     now gets org ownership through org_members.is_owner only and user_roles.role
--     = 'member'. Invited users keep their invited role unless it names 'owner'.
--   * transfer_org_ownership set the target's user_roles.role to 'owner' and the
--     caller's to 'admin'. It no longer touches user_roles.
-- API routes already refuse to assign 'owner' (lib/roles canManageRoleV2), so after
-- this migration the value is set only by hand in SQL.
--
-- Existing rows are not changed. Hosted production was cleaned by hand on
-- 2026-09-28. A self-hosted install created before this migration should list its
-- platform owners and demote any self-signup that is not one:
--   SELECT user_id FROM public.user_roles WHERE role = 'owner';
--
-- Idempotent: CREATE OR REPLACE keeps the trigger binding, owner, and grants.

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _role public.user_role;
  _invited_role text;
  _org_id uuid;
  _workspace_id uuid;
  _user_name text;
  _slug text;
  _role_id uuid;
BEGIN
  -- 1. Determine role from invitation metadata or default to member
  _invited_role := NEW.raw_user_meta_data->>'invited_role';
  BEGIN
    _role := _invited_role::public.user_role;
  EXCEPTION WHEN invalid_text_representation THEN
    _role := 'member';
  END;
  -- raw_user_meta_data is written by the signing-up client, so it can never grant 'owner'.
  IF _role IS NULL OR _role = 'owner' THEN
    _role := 'member';
  END IF;

  -- 2. Insert/update user_roles. 'owner' here marks the platform owner and is never set by this trigger.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _role)
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

  -- 3. Build a display name and slug from email
  _user_name := split_part(NEW.email, '@', 1);
  _slug := lower(regexp_replace(_user_name, '[^a-zA-Z0-9]', '-', 'g'));
  _slug := _slug || '-' || substr(gen_random_uuid()::text, 1, 4);

  -- 4. Check if this is an invited user (has invitation pending)
  SELECT org_id INTO _org_id
  FROM public.org_memberships
  WHERE user_id = NEW.id
  LIMIT 1;

  IF _org_id IS NOT NULL THEN
    -- Invited user: org_membership was pre-created by invite flow.
    UPDATE public.user_roles SET org_id = _org_id WHERE user_id = NEW.id;

    -- Resolve RBAC role_id from invitation role
    SELECT id INTO _role_id FROM public.roles WHERE slug = _invited_role LIMIT 1;
    IF _role_id IS NULL THEN
      SELECT id INTO _role_id FROM public.roles WHERE slug = 'member' LIMIT 1;
    END IF;

    -- Also create org_members row for RBAC v2
    INSERT INTO public.org_members (user_id, org_id, role_id, is_owner, is_active)
    VALUES (NEW.id, _org_id, _role_id, false, true)
    ON CONFLICT DO NOTHING;

    -- Add to default workspace of that org
    SELECT id INTO _workspace_id
    FROM public.workspaces
    WHERE org_id = _org_id AND is_default = true
    LIMIT 1;

    IF _workspace_id IS NOT NULL THEN
      INSERT INTO public.workspace_memberships (user_id, workspace_id)
      VALUES (NEW.id, _workspace_id)
      ON CONFLICT (user_id, workspace_id) DO NOTHING;
    END IF;
  ELSE
    -- Self-signup: create org + workspace + memberships
    INSERT INTO public.organizations (name, slug, owner_id)
    VALUES (_user_name || '''s Org', _slug, NEW.id)
    RETURNING id INTO _org_id;

    -- Create org_membership as owner (legacy)
    INSERT INTO public.org_memberships (org_id, user_id, role)
    VALUES (_org_id, NEW.id, 'owner')
    ON CONFLICT DO NOTHING;

    -- Create org_members row for RBAC v2
    SELECT id INTO _role_id FROM public.roles WHERE slug = 'owner' LIMIT 1;
    INSERT INTO public.org_members (user_id, org_id, role_id, is_owner, is_active)
    VALUES (NEW.id, _org_id, _role_id, true, true)
    ON CONFLICT DO NOTHING;

    -- Org ownership lives in org_members.is_owner; user_roles stays 'member'.
    UPDATE public.user_roles SET org_id = _org_id, role = 'member' WHERE user_id = NEW.id;

    -- Create default workspace
    INSERT INTO public.workspaces (org_id, name, slug, is_default)
    VALUES (_org_id, 'Main', _slug || '-main', true)
    RETURNING id INTO _workspace_id;

    -- Create workspace_membership
    INSERT INTO public.workspace_memberships (user_id, workspace_id)
    VALUES (NEW.id, _workspace_id)
    ON CONFLICT (user_id, workspace_id) DO NOTHING;
  END IF;

  -- 5. Log provisioning
  BEGIN
    INSERT INTO public.activity_log (event_type, severity, source, title, actor_user_id, workspace_id)
    VALUES (
      'user.provisioned',
      'info',
      'system',
      'User auto-provisioned: ' || NEW.email,
      NEW.id,
      _workspace_id
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_org_ownership(p_from_user uuid, p_to_user uuid, p_org_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_caller_member_id UUID;
  v_target_member_id UUID;
BEGIN
  -- 1. Verify caller is an active owner of this org
  SELECT id INTO v_caller_member_id
    FROM org_members
   WHERE user_id = p_from_user
     AND org_id  = p_org_id
     AND is_owner = true
     AND is_active = true;

  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Caller is not an owner of org %', p_org_id;
  END IF;

  -- 2. Verify target is an active, non-owner member of this org
  SELECT id INTO v_target_member_id
    FROM org_members
   WHERE user_id   = p_to_user
     AND org_id    = p_org_id
     AND is_active = true
     AND is_owner  = false;

  IF v_target_member_id IS NULL THEN
    RAISE EXCEPTION 'Target user is not an eligible member of org %', p_org_id;
  END IF;

  -- 3. Atomic swap: revoke from caller, grant to target
  UPDATE org_members SET is_owner = false WHERE id = v_caller_member_id;
  UPDATE org_members SET is_owner = true  WHERE id = v_target_member_id;

  -- 4. user_roles is left alone: its 'owner' value marks the platform owner, which
  --    transferring an org must neither grant to the target nor take from the caller.
END;
$$;

COMMENT ON FUNCTION public.resolve_user_permissions(uuid, uuid) IS
  'Resolves a user''s permissions. user_roles.role = ''owner'' marks the platform owner; only a manual SQL update sets it.';
