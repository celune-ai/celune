-- 028-get-users-rpc.sql
-- SECURITY DEFINER helpers for querying auth.users without Admin API overhead.
-- (1) get_users_by_ids     — batch lookup by UUID array (replaces N+1 getUserById calls)
-- (2) get_pending_invitations — list unconfirmed invited users (replaces listUsers() + filter)

-- ============================================================
-- get_users_by_ids(user_ids uuid[])
-- Batch-fetch id, email, display_name for a given array of user IDs.
-- SECURITY DEFINER grants access to auth.users from the public schema.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_users_by_ids(user_ids uuid[])
RETURNS TABLE (
  id           uuid,
  email        text,
  display_name text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    u.id,
    u.email,
    (u.raw_user_meta_data->>'display_name')::text AS display_name
  FROM auth.users u
  WHERE u.id = ANY(user_ids);
$$;

-- Lock down execute permissions
REVOKE ALL ON FUNCTION public.get_users_by_ids(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_users_by_ids(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_users_by_ids(uuid[]) TO service_role;

-- ============================================================
-- get_pending_invitations()
-- Returns users who have been invited but have not yet confirmed.
-- Replaces auth.admin.listUsers() + client-side filter in /api/invitations.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_pending_invitations()
RETURNS TABLE (
  id           uuid,
  email        text,
  invited_at   timestamptz,
  created_at   timestamptz,
  invited_role text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    u.id,
    u.email,
    u.invited_at,
    u.created_at,
    (u.raw_user_meta_data->>'invited_role')::text AS invited_role
  FROM auth.users u
  WHERE u.invited_at IS NOT NULL
    AND u.email_confirmed_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.get_pending_invitations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_invitations() TO service_role;

-- ============================================================
-- get_invitation_user(p_user_id uuid)
-- Returns a single pending-invitation row for resend / revoke handlers.
-- Returns NULL row if the user does not exist or is already confirmed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_invitation_user(p_user_id uuid)
RETURNS TABLE (
  id             uuid,
  email          text,
  invited_at     timestamptz,
  confirmed_at   timestamptz,
  invited_role   text,
  banned_until   timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    u.id,
    u.email,
    u.invited_at,
    u.email_confirmed_at   AS confirmed_at,
    (u.raw_user_meta_data->>'invited_role')::text AS invited_role,
    u.banned_until
  FROM auth.users u
  WHERE u.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.get_invitation_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invitation_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_invitation_user(uuid) TO service_role;
