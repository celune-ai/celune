-- 027_add_is_active_to_user_roles.sql
-- Adds is_active column to user_roles for soft-deactivation of users.
-- When is_active = false, the user is soft-disabled without deleting their account.
-- Depends on: 024-user-roles.sql

ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.user_roles.is_active IS
  'Soft-disable flag. When false the user is deactivated without deletion.';
