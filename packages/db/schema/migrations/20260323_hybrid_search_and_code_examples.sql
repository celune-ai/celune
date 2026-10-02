-- Migration: Hybrid brain search + code examples table
-- Part of: Brain Intelligence Upgrade (Archon Adaptations)
-- Sprint 1: Tasks fa38564f (hybrid search) + 52dd66b5 (code extraction)

-- =============================================================================
-- 1. hybrid_brain_search() — combines vector similarity + tsvector keyword rank
-- =============================================================================
-- Existing match_memories() is vector-only. This adds keyword scoring and
-- blends both signals for higher recall on exact terms (function names, error
-- codes, config keys) while preserving semantic understanding.

CREATE OR REPLACE FUNCTION hybrid_brain_search(
  query_embedding vector,
  query_text text,
  filter_workspace_id uuid,
  match_count integer DEFAULT 20,
  p_vector_weight double precision DEFAULT 0.7,
  p_keyword_weight double precision DEFAULT 0.3,
  filter_category text DEFAULT NULL,
  filter_source text DEFAULT NULL,
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
  importance_score double precision,
  vector_similarity double precision,
  keyword_rank double precision,
  combined_score double precision,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ts_query tsquery;
BEGIN
  -- Enable iterative scan for RLS compatibility with HNSW
  SET LOCAL hnsw.iterative_scan = 'relaxed_order';
  SET LOCAL hnsw.max_scan_tuples = 20000;

  -- Convert query text to tsquery; if it fails, use NULL (vector-only fallback)
  BEGIN
    ts_query := plainto_tsquery('english', query_text);
  EXCEPTION WHEN OTHERS THEN
    ts_query := NULL;
  END;

  RETURN QUERY
  WITH vector_results AS (
    -- Phase 1: Get top candidates from vector search (cast wide net)
    SELECT
      am.id,
      am.key,
      am.content,
      am.abstract,
      am.category,
      am.source,
      am.tags,
      am.memory_type,
      am.importance_score,
      am.fts,
      1 - (am.embedding <=> query_embedding) AS vec_sim,
      am.created_at,
      am.updated_at
    FROM agent_memory am
    WHERE am.embedding IS NOT NULL
      AND am.workspace_id = filter_workspace_id
      AND (p_include_archived OR NOT COALESCE(am.is_archived, false))
      AND (filter_category IS NULL OR am.category = filter_category)
      AND (filter_source IS NULL OR am.source = filter_source)
      AND 1 - (am.embedding <=> query_embedding) > 0.3  -- wider threshold for blending
    ORDER BY am.embedding <=> query_embedding
    LIMIT match_count * 3  -- over-fetch for re-ranking
  ),
  keyword_results AS (
    -- Phase 2: Get keyword matches (only if tsquery is valid)
    SELECT
      am.id,
      ts_rank_cd(am.fts, ts_query, 32) AS kw_rank  -- normalization: rank / (1 + rank)
    FROM agent_memory am
    WHERE ts_query IS NOT NULL
      AND am.fts @@ ts_query
      AND am.workspace_id = filter_workspace_id
      AND (p_include_archived OR NOT COALESCE(am.is_archived, false))
      AND (filter_category IS NULL OR am.category = filter_category)
      AND (filter_source IS NULL OR am.source = filter_source)
    LIMIT match_count * 3
  ),
  combined AS (
    -- Phase 3: Merge and score
    SELECT
      vr.id,
      vr.key,
      vr.content,
      vr.abstract,
      vr.category,
      vr.source,
      vr.tags,
      vr.memory_type,
      vr.importance_score,
      vr.vec_sim,
      COALESCE(kr.kw_rank, 0.0) AS kw_rank,
      -- Normalize keyword rank to 0-1 range (ts_rank_cd with norm=32 is already 0-1ish)
      -- Combined score: weighted blend of vector similarity and keyword rank
      (vr.vec_sim * p_vector_weight)
        + (COALESCE(kr.kw_rank, 0.0) * p_keyword_weight)
        + (COALESCE(vr.importance_score, 0.5) * 0.1)  -- small importance boost
      AS combo_score,
      vr.created_at,
      vr.updated_at
    FROM vector_results vr
    LEFT JOIN keyword_results kr ON kr.id = vr.id

    UNION ALL

    -- Include keyword-only matches (no vector hit but strong keyword match)
    SELECT
      am.id,
      am.key,
      am.content,
      am.abstract,
      am.category,
      am.source,
      am.tags,
      am.memory_type,
      am.importance_score,
      0.0 AS vec_sim,
      kr.kw_rank,
      (kr.kw_rank * p_keyword_weight) + (COALESCE(am.importance_score, 0.5) * 0.1) AS combo_score,
      am.created_at,
      am.updated_at
    FROM keyword_results kr
    JOIN agent_memory am ON am.id = kr.id
    WHERE kr.id NOT IN (SELECT vr2.id FROM vector_results vr2)
  )
  SELECT
    c.id,
    c.key,
    c.content,
    c.abstract,
    c.category,
    c.source,
    c.tags,
    c.memory_type,
    c.importance_score,
    c.vec_sim AS vector_similarity,
    c.kw_rank AS keyword_rank,
    c.combo_score AS combined_score,
    c.created_at,
    c.updated_at
  FROM combined c
  ORDER BY c.combo_score DESC
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION hybrid_brain_search IS
  'Hybrid search combining pgvector cosine similarity with PostgreSQL tsvector keyword ranking. '
  'Returns results scored by weighted blend of semantic meaning and exact term matches.';


-- =============================================================================
-- 2. brain_code_examples — indexed code blocks extracted from skills
-- =============================================================================
-- During brain manifest sync or skill creation, code blocks are extracted from
-- skill descriptions/content, stored with language tags, and made searchable.

CREATE TABLE IF NOT EXISTS brain_code_examples (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  manifest_id uuid REFERENCES brain_manifest(id) ON DELETE CASCADE,
  -- The extracted code block
  code_block text NOT NULL,
  language text DEFAULT 'text',  -- e.g. 'typescript', 'sql', 'bash', 'python'
  -- AI-generated summary of what the code does (1-2 sentences)
  summary text,
  -- Context: which skill/path this came from
  source_path text,
  -- Embedding for semantic search over code examples
  embedding vector(384),
  embedding_status text DEFAULT 'none' CHECK (embedding_status IN ('none', 'pending', 'complete', 'failed')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_brain_code_examples_workspace
  ON brain_code_examples(workspace_id);

CREATE INDEX IF NOT EXISTS idx_brain_code_examples_manifest
  ON brain_code_examples(manifest_id);

CREATE INDEX IF NOT EXISTS idx_brain_code_examples_language
  ON brain_code_examples(workspace_id, language);

-- HNSW index for vector search over code examples
CREATE INDEX IF NOT EXISTS brain_code_examples_embedding_hnsw
  ON brain_code_examples
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL;

-- FTS on summary + code_block for keyword search
ALTER TABLE brain_code_examples
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', COALESCE(summary, '') || ' ' || COALESCE(code_block, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_brain_code_examples_fts
  ON brain_code_examples USING gin(fts);

-- Unique constraint: same code block per manifest entry (prevent duplicates on re-sync)
CREATE UNIQUE INDEX IF NOT EXISTS brain_code_examples_manifest_hash
  ON brain_code_examples(manifest_id, md5(code_block))
  WHERE manifest_id IS NOT NULL;

-- RLS
ALTER TABLE brain_code_examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY brain_code_examples_workspace_read ON brain_code_examples
  FOR SELECT USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_memberships wm WHERE wm.user_id = auth.uid()
    )
  );

CREATE POLICY brain_code_examples_service_all ON brain_code_examples
  FOR ALL USING (auth.role() = 'service_role');


-- =============================================================================
-- 3. search_code_examples() — semantic + keyword search over code blocks
-- =============================================================================

CREATE OR REPLACE FUNCTION search_code_examples(
  query_embedding vector,
  query_text text,
  filter_workspace_id uuid,
  match_count integer DEFAULT 10,
  filter_language text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  code_block text,
  language text,
  summary text,
  source_path text,
  vector_similarity double precision,
  keyword_rank double precision,
  combined_score double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ts_query tsquery;
BEGIN
  SET LOCAL hnsw.iterative_scan = 'relaxed_order';
  SET LOCAL hnsw.max_scan_tuples = 10000;

  BEGIN
    ts_query := plainto_tsquery('english', query_text);
  EXCEPTION WHEN OTHERS THEN
    ts_query := NULL;
  END;

  RETURN QUERY
  SELECT
    bce.id,
    bce.code_block,
    bce.language,
    bce.summary,
    bce.source_path,
    CASE WHEN bce.embedding IS NOT NULL
      THEN 1 - (bce.embedding <=> query_embedding)
      ELSE 0.0
    END AS vector_similarity,
    CASE WHEN ts_query IS NOT NULL AND bce.fts @@ ts_query
      THEN ts_rank_cd(bce.fts, ts_query, 32)
      ELSE 0.0
    END AS keyword_rank,
    -- Combined: 60% vector + 40% keyword (code search favors exact matches)
    (CASE WHEN bce.embedding IS NOT NULL
      THEN (1 - (bce.embedding <=> query_embedding)) * 0.6
      ELSE 0.0
    END)
    + (CASE WHEN ts_query IS NOT NULL AND bce.fts @@ ts_query
      THEN ts_rank_cd(bce.fts, ts_query, 32) * 0.4
      ELSE 0.0
    END) AS combined_score
  FROM brain_code_examples bce
  WHERE bce.workspace_id = filter_workspace_id
    AND (filter_language IS NULL OR bce.language = filter_language)
    AND (
      (bce.embedding IS NOT NULL AND 1 - (bce.embedding <=> query_embedding) > 0.3)
      OR (ts_query IS NOT NULL AND bce.fts @@ ts_query)
    )
  ORDER BY combined_score DESC
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION search_code_examples IS
  'Search code examples extracted from brain manifest skills using hybrid vector + keyword search.';
