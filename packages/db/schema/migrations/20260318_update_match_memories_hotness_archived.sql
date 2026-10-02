-- Drop all old overloads
DROP FUNCTION IF EXISTS match_memories(vector, double precision, integer, text, text);
DROP FUNCTION IF EXISTS match_memories(vector, double precision, integer, text, text, uuid, uuid);
DROP FUNCTION IF EXISTS match_memories(vector, double precision, integer, text, text, uuid, uuid, uuid);

-- Recreate with hotness scoring and archived filtering
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector,
  match_threshold double precision DEFAULT 0.5,
  match_count integer DEFAULT 20,
  filter_source text DEFAULT NULL,
  filter_category text DEFAULT NULL,
  filter_org_id uuid DEFAULT NULL,
  filter_workspace_id uuid DEFAULT NULL,
  filter_user_id uuid DEFAULT NULL,
  p_include_archived boolean DEFAULT false
)
RETURNS TABLE(
  id uuid,
  key text,
  content text,
  abstract varchar(500),
  category text,
  source text,
  tags text,
  memory_type text,
  agent_id text,
  importance_score double precision,
  similarity double precision,
  hotness_score double precision,
  final_score double precision,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Enable iterative scan for RLS compatibility with HNSW
  SET LOCAL hnsw.iterative_scan = 'relaxed_order';
  SET LOCAL hnsw.max_scan_tuples = 20000;

  RETURN QUERY
  SELECT
    am.id,
    am.key,
    am.content,
    am.abstract,
    am.category,
    am.source,
    am.tags,
    am.memory_type,
    am.agent_id,
    am.importance_score,
    1 - (am.embedding <=> query_embedding) AS similarity,
    -- Hotness: sigmoid of access count * exponential decay (7-day half-life), floor at 0.05
    GREATEST(0.05,
      (1.0 / (1.0 + exp(-ln(1.0 + COALESCE(am.access_count, 0)))))
      * exp(-0.693 * EXTRACT(EPOCH FROM (now() - COALESCE(am.updated_at, am.created_at))) / 604800.0)
    ) AS hotness_score,
    -- Final blended score: 60% similarity + 20% hotness + 20% importance
    (1 - (am.embedding <=> query_embedding)) * 0.6
    + GREATEST(0.05,
        (1.0 / (1.0 + exp(-ln(1.0 + COALESCE(am.access_count, 0)))))
        * exp(-0.693 * EXTRACT(EPOCH FROM (now() - COALESCE(am.updated_at, am.created_at))) / 604800.0)
      ) * 0.2
    + COALESCE(am.importance_score, 0.5) * 0.2
    AS final_score,
    am.created_at,
    am.updated_at
  FROM agent_memory am
  WHERE am.embedding IS NOT NULL
    AND 1 - (am.embedding <=> query_embedding) > match_threshold
    AND (p_include_archived OR NOT COALESCE(am.is_archived, false))
    AND (filter_user_id IS NULL OR am.user_id = filter_user_id)
    AND (filter_source IS NULL OR am.source = filter_source)
    AND (filter_category IS NULL OR am.category = filter_category)
    AND (filter_org_id IS NULL OR am.org_id = filter_org_id)
    AND (filter_workspace_id IS NULL OR am.workspace_id = filter_workspace_id)
  ORDER BY final_score DESC
  LIMIT match_count;
END;
$$;
