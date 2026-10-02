-- 007-agent-memory.sql
-- E3: Cross-Agent Memory Handoff
-- Creates agent_memory table in Supabase (mirrors brain.sqlite schema)
-- Adds context_keys to tasks for linking memory entries to tasks

-- Agent memory table
CREATE TABLE IF NOT EXISTS agent_memory (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key text UNIQUE NOT NULL,
  category text NOT NULL DEFAULT 'general'
    CHECK (category IN ('preference', 'decision', 'context', 'fact', 'general', 'handoff')),
  content text NOT NULL,
  tags text DEFAULT '',
  source text DEFAULT 'unknown',
  version int DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  expires_at timestamptz
);

-- RLS: service_role full access, authenticated read-only
ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on agent_memory"
  ON agent_memory
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated read-only on agent_memory"
  ON agent_memory
  FOR SELECT
  TO authenticated
  USING (true);

-- Add context_keys to tasks for linking memory entries
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS context_keys text[] DEFAULT '{}';

-- GIN index for efficient array lookups
CREATE INDEX IF NOT EXISTS idx_tasks_context_keys ON tasks USING GIN (context_keys);

-- Index for common queries on agent_memory
CREATE INDEX IF NOT EXISTS idx_agent_memory_category ON agent_memory (category);
CREATE INDEX IF NOT EXISTS idx_agent_memory_source ON agent_memory (source);
CREATE INDEX IF NOT EXISTS idx_agent_memory_expires_at ON agent_memory (expires_at) WHERE expires_at IS NOT NULL;
