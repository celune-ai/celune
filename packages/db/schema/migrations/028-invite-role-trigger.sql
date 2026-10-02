-- 028-invite-role-trigger.sql
-- Update handle_new_user trigger to honour invited_role from user metadata.
-- When a user is created via inviteUserByEmail, Supabase stores the invited role
-- in raw_user_meta_data->>'invited_role'. This trigger reads that value so the
-- correct role is assigned immediately on user creation.
-- Falls back to 'member' for self-signup (no invited_role in metadata).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  _role user_role;
BEGIN
  -- Use invited_role from metadata if present and valid, otherwise default to 'member'
  BEGIN
    _role := (NEW.raw_user_meta_data->>'invited_role')::user_role;
  EXCEPTION WHEN invalid_text_representation THEN
    _role := 'member';
  END;

  IF _role IS NULL THEN
    _role := 'member';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _role)
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
