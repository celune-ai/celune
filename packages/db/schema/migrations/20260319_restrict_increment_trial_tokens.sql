-- Restrict increment_trial_tokens to service role only.
-- This SECURITY DEFINER function should not be callable by anon/authenticated clients.
--
-- Rollback: GRANT EXECUTE ON FUNCTION increment_trial_tokens(uuid, integer) TO authenticated, anon;

REVOKE EXECUTE ON FUNCTION increment_trial_tokens(uuid, integer) FROM public, anon, authenticated;
