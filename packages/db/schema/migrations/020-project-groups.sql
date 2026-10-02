-- Project Groups (Epics) — bundle projects into higher-level initiatives
CREATE TABLE IF NOT EXISTS project_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add group_id FK to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES project_groups(id) ON DELETE SET NULL;

-- Index for fast group lookups
CREATE INDEX IF NOT EXISTS idx_projects_group_id ON projects(group_id);

-- RLS policies for project_groups (match projects table pattern)
ALTER TABLE project_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to project_groups" ON project_groups
  FOR ALL USING (true) WITH CHECK (true);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_project_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_groups_updated_at
  BEFORE UPDATE ON project_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_project_groups_updated_at();
