-- Auto-provision organization, workspace, and memberships for new users.
-- Extends handle_new_user() to create complete workspace context on signup.
-- For self-signup: creates default org + workspace + memberships.
-- For invited users: links to inviter's org via invitation record.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  _role public.user_role;
  _invited_role text;
  _org_id uuid;
  _workspace_id uuid;
  _user_name text;
  _slug text;
BEGIN
  -- 1. Determine role from invitation metadata or default to member
  _invited_role := NEW.raw_user_meta_data->>'invited_role';
  BEGIN
    _role := _invited_role::public.user_role;
  EXCEPTION WHEN invalid_text_representation THEN
    _role := 'member';
  END;
  IF _role IS NULL THEN
    _role := 'member';
  END IF;

  -- 2. Insert/update user_roles
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _role)
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

  -- 3. Build a display name and slug from email
  _user_name := split_part(NEW.email, '@', 1);
  _slug := lower(regexp_replace(_user_name, '[^a-zA-Z0-9]', '-', 'g'));
  -- Ensure slug uniqueness by appending random suffix
  _slug := _slug || '-' || substr(gen_random_uuid()::text, 1, 4);

  -- 4. Check if this is an invited user (has invitation pending)
  SELECT org_id INTO _org_id
  FROM public.org_memberships
  WHERE user_id = NEW.id
  LIMIT 1;

  IF _org_id IS NOT NULL THEN
    -- Invited user: org_membership was pre-created by invite flow.
    -- Update user_roles.org_id to link to the org.
    UPDATE public.user_roles SET org_id = _org_id WHERE user_id = NEW.id;

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

    -- Create org_membership as owner
    INSERT INTO public.org_memberships (org_id, user_id, role)
    VALUES (_org_id, NEW.id, 'owner')
    ON CONFLICT DO NOTHING;

    -- Update user_roles with org_id
    UPDATE public.user_roles SET org_id = _org_id WHERE user_id = NEW.id;

    -- Create default workspace
    INSERT INTO public.workspaces (org_id, name, slug, is_default)
    VALUES (_org_id, 'Main', _slug || '-main', true)
    RETURNING id INTO _workspace_id;

    -- Create workspace_membership
    INSERT INTO public.workspace_memberships (user_id, workspace_id)
    VALUES (NEW.id, _workspace_id)
    ON CONFLICT (user_id, workspace_id) DO NOTHING;
  END IF;

  -- 5. Log provisioning (fire-and-forget, don't block on failure)
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
    -- Don't let activity log failure block user creation
    NULL;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
