-- Add org_id to claude_usage for defense-in-depth multi-org isolation
ALTER TABLE claude_usage ADD COLUMN org_id uuid REFERENCES organizations(id);

CREATE INDEX idx_claude_usage_org_id ON claude_usage(org_id);

-- Backfill org_id from the user's org membership
UPDATE claude_usage cu
SET org_id = om.org_id
FROM org_memberships om
WHERE om.user_id = cu.user_id
  AND cu.org_id IS NULL;
