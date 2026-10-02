-- Migration: Multi-tenant RLS policies + match_memories RPC
-- Sprint 1, Task 3: Replace user-only RLS with workspace-aware policies
--
-- Depends on: 20260307_agent_memory_multitenant_columns.sql (org_id, workspace_id exist)
-- Pattern: matches activity_log, agent_configs, task_comments RLS style

-- Drop existing user-only policies
DROP POLICY IF EXISTS "agent_memory_select_user" ON agent_memory;
DROP POLICY IF EXISTS "agent_memory_insert_user" ON agent_memory;
DROP POLICY IF EXISTS "agent_memory_update_user" ON agent_memory;
DROP POLICY IF EXISTS "agent_memory_delete_user" ON agent_memory;

-- Ensure RLS is enabled
ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

-- SELECT: user sees own memories in accessible workspaces (or unscoped memories)
CREATE POLICY agent_memory_select_multitenant ON agent_memory
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND (
      workspace_id IS NULL
      OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
    )
  );

-- INSERT: user can only insert own memories in accessible workspaces
CREATE POLICY agent_memory_insert_multitenant ON agent_memory
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      workspace_id IS NULL
      OR workspace_id IN (SELECT user_workspace_ids(auth.uid()))
    )
  );

-- UPDATE: own rows only, workspace must remain accessible
CREATE POLICY agent_memory_update_multitenant ON agent_memory
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- DELETE: own rows only
CREATE POLICY agent_memory_delete_multitenant ON agent_memory
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- service_role bypasses RLS automatically (Supabase built-in) — no explicit policy needed

-------------------------------------------------------------------
-- match_memories() RPC — Semantic search with multi-tenant filtering
-------------------------------------------------------------------
-- Uses iterative HNSW scan to prevent zero-result problem when RLS
-- post-filters to a small fraction of total rows.
--
-- Call: supabase.rpc('match_memories', { query_embedding, match_threshold, match_count, filter_org_id, filter_workspace_id })

CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(384),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 20,
  filter_source text DEFAULT NULL,
  filter_category text DEFAULT NULL,
  filter_org_id uuid DEFAULT NULL,
  filter_workspace_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  key text,
  content text,
  category text,
  source text,
  tags text,
  memory_type text,
  agent_id text,
  importance_score float,
  similarity float,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Enable iterative scan for RLS compatibility with HNSW
  -- Without this, sub-1% selectivity (one user's memories out of all) returns near-zero results
  SET LOCAL hnsw.iterative_scan = 'relaxed_order';
  SET LOCAL hnsw.max_scan_tuples = 20000;

  RETURN QUERY
  SELECT
    am.id,
    am.key,
    am.content,
    am.category,
    am.source,
    am.tags,
    am.memory_type,
    am.agent_id,
    am.importance_score,
    1 - (am.embedding <=> query_embedding) AS similarity,
    am.created_at,
    am.updated_at
  FROM agent_memory am
  WHERE am.embedding IS NOT NULL
    AND 1 - (am.embedding <=> query_embedding) > match_threshold
    AND (filter_source IS NULL OR am.source = filter_source)
    AND (filter_category IS NULL OR am.category = filter_category)
    AND (filter_org_id IS NULL OR am.org_id = filter_org_id)
    AND (filter_workspace_id IS NULL OR am.workspace_id = filter_workspace_id)
  ORDER BY am.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Update access tracking: bump access_count and last_accessed_at when memories are read
-- This is called by the app layer, not automatically — keeps the RPC fast
CREATE OR REPLACE FUNCTION touch_memories(memory_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE agent_memory
  SET access_count = access_count + 1,
      last_accessed_at = now()
  WHERE id = ANY(memory_ids);
$$;
