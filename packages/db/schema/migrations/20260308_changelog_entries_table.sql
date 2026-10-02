-- Changelog entries table for automated PR merge → changelog pipeline
-- Applied 2026-03-08

CREATE TABLE IF NOT EXISTS changelog_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  title text NOT NULL,
  description text NOT NULL,
  category text NOT NULL DEFAULT 'Feature',
  version text,
  body text,
  pr_number integer,
  pr_url text,
  repo text,
  auto_generated boolean DEFAULT true,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_changelog_entries_date ON changelog_entries(date DESC);
CREATE INDEX IF NOT EXISTS idx_changelog_entries_pr ON changelog_entries(pr_number);
