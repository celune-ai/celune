-- Migration 20260929_vector_search_functions: make semantic memory search work again.
--
-- hybrid_brain_search, match_memories, and search_code_examples had search_path = public, so
-- `<=>` on extensions.vector failed with "operator does not exist" and recall_memory fell back to
-- keyword search. With the path fixed, the functions then failed "structure of query does not
-- match function result type": ts_rank_cd returns real and the hotness expression returns
-- numeric, while the result columns are double precision. This pins search_path to
-- public, extensions and casts those expressions. Signatures, result types, SECURITY DEFINER,
-- and the hnsw settings are unchanged. CREATE OR REPLACE keeps grants and comments; the
-- REVOKE/GRANT at the end restates 20260927_revoke_user_execute_on_definer_rpcs.sql.
-- Idempotent.

CREATE OR REPLACE FUNCTION public.hybrid_brain_search(query_embedding extensions.vector, query_text text, filter_workspace_id uuid, match_count integer DEFAULT 20, p_vector_weight double precision DEFAULT 0.7, p_keyword_weight double precision DEFAULT 0.3, filter_category text DEFAULT NULL::text, filter_source text DEFAULT NULL::text, p_include_archived boolean DEFAULT false)
 RETURNS TABLE(id uuid, key text, content text, abstract character varying, category text, source text, tags text, memory_type text, importance_score double precision, vector_similarity double precision, keyword_rank double precision, combined_score double precision, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
      ts_rank_cd(am.fts, ts_query, 32)::double precision AS kw_rank  -- normalization: rank / (1 + rank)
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
$function$;

CREATE OR REPLACE FUNCTION public.match_memories(query_embedding extensions.vector, match_threshold double precision DEFAULT 0.5, match_count integer DEFAULT 20, filter_source text DEFAULT NULL::text, filter_category text DEFAULT NULL::text, filter_org_id uuid DEFAULT NULL::uuid, filter_workspace_id uuid DEFAULT NULL::uuid, filter_user_id uuid DEFAULT NULL::uuid, p_include_archived boolean DEFAULT false)
 RETURNS TABLE(id uuid, key text, content text, abstract character varying, category text, source text, tags text, memory_type text, agent_id text, importance_score double precision, similarity double precision, hotness_score double precision, final_score double precision, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
    )::double precision AS hotness_score,
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
$function$;

CREATE OR REPLACE FUNCTION public.search_code_examples(query_embedding extensions.vector, query_text text, filter_workspace_id uuid, match_count integer DEFAULT 10, filter_language text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, code_block text, language text, summary text, source_path text, vector_similarity double precision, keyword_rank double precision, combined_score double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
      THEN ts_rank_cd(bce.fts, ts_query, 32)::double precision
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
$function$;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.hybrid_brain_search(extensions.vector, text, uuid, integer, double precision, double precision, text, text, boolean)',
    'public.match_memories(extensions.vector, double precision, integer, text, text, uuid, uuid, uuid, boolean)',
    'public.search_code_examples(extensions.vector, text, uuid, integer, text)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END;
$$;
