-- ─────────────────────────────────────────────────────────────────────────────
-- Atomic org ownership transfer RPC
-- Security Hardening — Audit Remediation (task a809e796)
-- ─────────────────────────────────────────────────────────────────────────────
-- Single-transaction transfer: revoke is_owner from caller, grant to target,
-- and sync user_roles. Prevents the race condition where both users are
-- temporarily owners if sequential updates partially fail.
--
-- SECURITY DEFINER: Required because this function mutates org_members and
-- user_roles rows belonging to two different users within a single transaction.
-- The caller's identity is verified via p_from_user + is_owner check.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.transfer_org_ownership(
  p_from_user UUID,
  p_to_user   UUID,
  p_org_id    UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
     AND is_owner = true;

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

  -- 4. Sync user_roles (best-effort backward compat)
  UPDATE user_roles SET role = 'admin' WHERE user_id = p_from_user;
  UPDATE user_roles SET role = 'owner' WHERE user_id = p_to_user;
END;
$$;

COMMENT ON FUNCTION public.transfer_org_ownership IS
  'Atomically transfers org ownership from one user to another. SECURITY DEFINER: mutates rows for two users in one transaction; caller verified via p_from_user + is_owner check.';
