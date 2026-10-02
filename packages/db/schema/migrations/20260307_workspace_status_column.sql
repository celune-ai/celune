-- Add status column to workspaces for lifecycle tracking
-- Values: draft (not fully set up), active (connected and ready), archived (soft-deleted), deprecated (flagged for removal)
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'
  CHECK (status IN ('active', 'draft', 'archived', 'deprecated'));

COMMENT ON COLUMN public.workspaces.status IS
  'Workspace lifecycle: draft (not fully set up), active (connected and ready), archived (soft-deleted), deprecated (flagged for removal)';
