-- Add priority to projects
CREATE TYPE project_priority AS ENUM ('low', 'medium', 'high', 'urgent');

ALTER TABLE projects
  ADD COLUMN priority project_priority NOT NULL DEFAULT 'medium';
