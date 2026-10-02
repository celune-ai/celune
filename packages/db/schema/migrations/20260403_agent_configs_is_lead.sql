-- Migration: 20260403_agent_configs_is_lead
-- Add explicit is_lead boolean to agent_configs.
-- Replaces string-matching on role column (role.includes('lead')).
--
-- ROLLBACK:
--   ALTER TABLE agent_configs DROP COLUMN IF EXISTS is_lead;

ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS is_lead boolean NOT NULL DEFAULT false;

-- Backfill: mark existing lead agents
UPDATE agent_configs
SET is_lead = true
WHERE lower(role) LIKE '%lead%';

-- Index for fast employment queries
CREATE INDEX IF NOT EXISTS idx_agent_configs_is_lead
  ON agent_configs(workspace_id, is_lead) WHERE is_lead = true;

-- Also create the consolidated employment view for single-query lookups
CREATE OR REPLACE FUNCTION get_employed_agents(p_workspace_id uuid)
RETURNS TABLE (
  agent_id text,
  display_name text,
  role text,
  agent_type text,
  is_lead boolean,
  is_active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH org_workspaces AS (
    -- Get all workspace IDs in the same org as the target workspace
    SELECT w2.id
    FROM workspaces w1
    JOIN workspaces w2 ON w1.org_id = w2.org_id
    WHERE w1.id = p_workspace_id
  ),
  -- Source of truth: earliest config per agent_id across org
  source_configs AS (
    SELECT DISTINCT ON (ac.agent_id)
      ac.agent_id,
      ac.display_name,
      ac.role,
      ac.agent_type,
      ac.is_lead
    FROM agent_configs ac
    WHERE ac.workspace_id IN (SELECT id FROM org_workspaces)
    ORDER BY ac.agent_id, ac.created_at ASC
  ),
  -- Per-workspace employment status
  local_status AS (
    SELECT ac.agent_id, ac.is_active
    FROM agent_configs ac
    WHERE ac.workspace_id = p_workspace_id
  )
  SELECT
    sc.agent_id,
    sc.display_name,
    sc.role,
    sc.agent_type,
    sc.is_lead,
    CASE
      WHEN sc.is_lead THEN true                          -- Lead agents always employed
      WHEN ls.agent_id IS NOT NULL THEN ls.is_active     -- Use workspace-local status
      ELSE false                                          -- No local record = not employed
    END AS is_active
  FROM source_configs sc
  LEFT JOIN local_status ls ON sc.agent_id = ls.agent_id
  WHERE
    sc.is_lead = true
    OR (ls.agent_id IS NOT NULL AND ls.is_active = true)
$$;

-- Grant execute to authenticated and service_role
GRANT EXECUTE ON FUNCTION get_employed_agents(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_employed_agents(uuid) TO service_role;
