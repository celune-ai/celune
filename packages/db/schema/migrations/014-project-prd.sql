-- Add PRD (Product Requirements Document) support to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS prd_content text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS prd_metadata jsonb;

-- Index for querying projects by PRD metadata
CREATE INDEX IF NOT EXISTS idx_projects_prd_metadata
  ON projects USING gin (prd_metadata)
  WHERE prd_metadata IS NOT NULL;
