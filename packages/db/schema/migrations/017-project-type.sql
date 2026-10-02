-- 017: Project type classification (feature vs improvement)
-- Enables filtering projects by type in the admin UI tabs

-- Create enum for project types
DO $$ BEGIN
  CREATE TYPE project_type AS ENUM ('feature', 'improvement');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add project_type column with default 'feature' for existing projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type project_type NOT NULL DEFAULT 'feature';

-- Index for fast tab filtering
CREATE INDEX IF NOT EXISTS idx_projects_project_type ON projects (project_type);

COMMENT ON COLUMN projects.project_type IS 'feature = product features/initiatives, improvement = weekly cleanup/retro action items';
