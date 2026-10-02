-- Migration: Add filter_user_id parameter to match_memories RPC
-- Addresses: SECURITY DEFINER function had no user_id WHERE clause, allowing
-- cross-user data access when filter_workspace_id was NULL or manipulated.
-- This adds an optional filter_user_id parameter and applies it in the WHERE clause.
-- The semantic-search route always passes auth.uid() as filter_user_id.

CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(384),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 20,
  filter_source text DEFAULT NULL,
  filter_category text DEFAULT NULL,
  filter_org_id uuid DEFAULT NULL,
  filter_workspace_id uuid DEFAULT NULL,
  filter_user_id uuid DEFAULT NULL
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
    AND (filter_user_id IS NULL OR am.user_id = filter_user_id)
    AND (filter_source IS NULL OR am.source = filter_source)
    AND (filter_category IS NULL OR am.category = filter_category)
    AND (filter_org_id IS NULL OR am.org_id = filter_org_id)
    AND (filter_workspace_id IS NULL OR am.workspace_id = filter_workspace_id)
  ORDER BY am.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
