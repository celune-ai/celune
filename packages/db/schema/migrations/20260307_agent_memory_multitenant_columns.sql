-- Migration: Add multi-tenant scoping columns to agent_memory
-- Sprint 1, Task 1: Enable org/workspace/agent scoping + pgvector embedding
-- MUST run before any second user signs up
--
-- Depends on: organizations(id), workspaces(id), auth.users(id) already existing
-- Safe: all new columns have defaults or are nullable, no data loss

-- Ensure pgvector extension is available
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Add multi-tenant scoping columns
ALTER TABLE agent_memory
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_id text NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS memory_type text NOT NULL DEFAULT 'fact'
    CHECK (memory_type IN ('fact', 'preference', 'decision', 'context', 'episode', 'handoff'));

-- Add embedding columns for semantic search
ALTER TABLE agent_memory
  ADD COLUMN IF NOT EXISTS embedding vector(384),
  ADD COLUMN IF NOT EXISTS embedding_model text DEFAULT 'gte-small';

-- Add engagement tracking columns
ALTER TABLE agent_memory
  ADD COLUMN IF NOT EXISTS importance_score float DEFAULT 0.5
    CHECK (importance_score >= 0 AND importance_score <= 1),
  ADD COLUMN IF NOT EXISTS access_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_accessed_at timestamptz;

-- Backfill org_id and workspace_id from the owner's default workspace
-- All existing rows belong to the single current user (Eric)
UPDATE agent_memory am
SET
  org_id = w.org_id,
  workspace_id = w.id
FROM workspaces w
WHERE w.is_default = true
  AND am.org_id IS NULL
  AND am.user_id IS NOT NULL
  AND w.org_id = (
    SELECT om.org_id FROM org_memberships om
    WHERE om.user_id = am.user_id
    LIMIT 1
  );

-- Add indexes for efficient multi-tenant queries
CREATE INDEX IF NOT EXISTS idx_agent_memory_org_id ON agent_memory(org_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_workspace_id ON agent_memory(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_id ON agent_memory(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_memory_type ON agent_memory(memory_type);
CREATE INDEX IF NOT EXISTS idx_agent_memory_user_org ON agent_memory(user_id, org_id);

-- Add updated_at auto-update trigger (was missing)
CREATE OR REPLACE FUNCTION update_agent_memory_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_memory_updated_at ON agent_memory;
CREATE TRIGGER agent_memory_updated_at
  BEFORE UPDATE ON agent_memory
  FOR EACH ROW
  EXECUTE FUNCTION update_agent_memory_updated_at();
