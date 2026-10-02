-- Rename 'improvement' → 'system' project type.
-- System projects flag core platform items (brain, agents, infra) that users
-- can fork but should be warned about modifying.
--
-- NOTE: This was applied as two separate migrations because PostgreSQL
-- requires new enum values to be committed before they can be referenced.
-- Migration 1: ALTER TYPE project_type ADD VALUE 'system';
-- Migration 2: UPDATE + COMMENT (below)

-- Add 'system' enum value (idempotent)
-- ALTER TYPE project_type ADD VALUE IF NOT EXISTS 'system';
-- (already applied in migration 1)

-- Migrate existing rows
UPDATE projects SET project_type = 'system' WHERE project_type = 'improvement';

-- Update column comment
COMMENT ON COLUMN projects.project_type IS 'feature = product features/initiatives, system = platform health/brain/agents/infra, research = investigation with deliverable, plan = non-code planning';
