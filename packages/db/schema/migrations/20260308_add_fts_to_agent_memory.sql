-- Add full-text search (tsvector) to agent_memory for workspace-scoped keyword search
-- This replaces the brain.sqlite FTS5 dependency

-- Add generated tsvector column for FTS
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(key, '') || ' ' || coalesce(content, '') || ' ' || coalesce(tags, ''))
  ) STORED;

-- GIN index for fast FTS queries
CREATE INDEX IF NOT EXISTS idx_agent_memory_fts ON agent_memory USING gin(fts);

-- Composite index for workspace + category filtering (common query pattern)
CREATE INDEX IF NOT EXISTS idx_agent_memory_workspace_category
  ON agent_memory(workspace_id, category);

-- Replace the old (key, user_id) unique constraint with workspace-scoped ones
ALTER TABLE agent_memory DROP CONSTRAINT IF EXISTS agent_memory_key_user_unique;

-- Create new workspace-scoped unique constraint
-- This allows the same key in different workspaces but prevents duplicates within a workspace
CREATE UNIQUE INDEX IF NOT EXISTS agent_memory_workspace_key_unique
  ON agent_memory(workspace_id, key) WHERE workspace_id IS NOT NULL;

-- Keep a unique constraint for non-workspace memories (backward compat)
CREATE UNIQUE INDEX IF NOT EXISTS agent_memory_key_user_no_ws_unique
  ON agent_memory(key, user_id) WHERE workspace_id IS NULL;
