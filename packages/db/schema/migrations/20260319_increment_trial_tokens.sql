-- Atomic increment of trial_tokens_used for a workspace.
-- Called by trackTrialUsage() to decrement the trial budget.
-- Uses LEAST to cap at the budget (never exceed it).
--
-- Rollback: DROP FUNCTION IF EXISTS increment_trial_tokens(uuid, integer);

CREATE OR REPLACE FUNCTION increment_trial_tokens(
  p_workspace_id uuid,
  p_tokens integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guard against negative increments (would grant free tokens)
  IF p_tokens <= 0 THEN RETURN; END IF;

  UPDATE workspaces
  SET trial_tokens_used = LEAST(
    trial_tokens_used + p_tokens,
    trial_token_budget
  )
  WHERE id = p_workspace_id;
END;
$$;
