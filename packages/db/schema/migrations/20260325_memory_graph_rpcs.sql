-- Memory Knowledge Graph: PostgreSQL RPCs for graph traversal
-- All RPCs are SECURITY INVOKER (respect RLS policies)

-- RPC 1: get_memory_graph — returns N-hop neighborhood (nodes + edges)
CREATE OR REPLACE FUNCTION get_memory_graph(
  p_memory_id uuid,
  p_depth int DEFAULT 2,
  p_workspace_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
  visited uuid[] := ARRAY[p_memory_id];
  frontier uuid[] := ARRAY[p_memory_id];
  next_frontier uuid[];
  current_depth int := 0;
  nodes jsonb := '[]'::jsonb;
  edges jsonb := '[]'::jsonb;
BEGIN
  -- Cap depth to prevent runaway traversal
  IF p_depth > 5 THEN p_depth := 5; END IF;

  -- Add seed node
  SELECT nodes || jsonb_build_array(jsonb_build_object(
    'id', am.id, 'key', am.key, 'category', am.category,
    'content', LEFT(am.content, 200), 'importance_score', am.importance_score,
    'created_at', am.created_at, 'depth', 0
  ))
  INTO nodes
  FROM public.agent_memory am
  WHERE am.id = p_memory_id
    AND (p_workspace_id IS NULL OR am.workspace_id = p_workspace_id);

  -- BFS traversal
  WHILE current_depth < p_depth AND array_length(frontier, 1) > 0 LOOP
    current_depth := current_depth + 1;
    next_frontier := '{}';

    -- Forward edges: memory_id IN frontier
    FOR result IN
      SELECT jsonb_build_object(
        'source', mr.memory_id, 'target', mr.related_id,
        'relation_type', mr.relation_type::text, 'confidence', mr.confidence,
        'is_auto_detected', mr.is_auto_detected
      ) as edge,
      mr.related_id as next_id,
      am.id, am.key, am.category, LEFT(am.content, 200) as content_preview,
      am.importance_score, am.created_at
      FROM public.memory_relations mr
      LEFT JOIN public.agent_memory am ON am.id = mr.related_id
      WHERE mr.memory_id = ANY(frontier)
        AND mr.related_type = 'memory'
        AND NOT (mr.related_id = ANY(visited))
        AND (p_workspace_id IS NULL OR mr.workspace_id = p_workspace_id)
    LOOP
      edges := edges || jsonb_build_array(result.edge);
      IF result.id IS NOT NULL THEN
        nodes := nodes || jsonb_build_array(jsonb_build_object(
          'id', result.id, 'key', result.key, 'category', result.category,
          'content', result.content_preview, 'importance_score', result.importance_score,
          'created_at', result.created_at, 'depth', current_depth
        ));
        visited := array_append(visited, result.next_id);
        next_frontier := array_append(next_frontier, result.next_id);
      END IF;
    END LOOP;

    -- Reverse edges: related_id IN frontier (memory-to-memory only)
    FOR result IN
      SELECT jsonb_build_object(
        'source', mr.memory_id, 'target', mr.related_id,
        'relation_type', mr.relation_type::text, 'confidence', mr.confidence,
        'is_auto_detected', mr.is_auto_detected
      ) as edge,
      mr.memory_id as next_id,
      am.id, am.key, am.category, LEFT(am.content, 200) as content_preview,
      am.importance_score, am.created_at
      FROM public.memory_relations mr
      LEFT JOIN public.agent_memory am ON am.id = mr.memory_id
      WHERE mr.related_id = ANY(frontier)
        AND mr.related_type = 'memory'
        AND NOT (mr.memory_id = ANY(visited))
        AND (p_workspace_id IS NULL OR mr.workspace_id = p_workspace_id)
    LOOP
      edges := edges || jsonb_build_array(result.edge);
      IF result.id IS NOT NULL THEN
        nodes := nodes || jsonb_build_array(jsonb_build_object(
          'id', result.id, 'key', result.key, 'category', result.category,
          'content', result.content_preview, 'importance_score', result.importance_score,
          'created_at', result.created_at, 'depth', current_depth
        ));
        visited := array_append(visited, result.next_id);
        next_frontier := array_append(next_frontier, result.next_id);
      END IF;
    END LOOP;

    frontier := next_frontier;
  END LOOP;

  RETURN jsonb_build_object('nodes', nodes, 'edges', edges);
END;
$$;

-- RPC 2: get_memory_context — returns memory + 1-hop related memories as assembled context
CREATE OR REPLACE FUNCTION get_memory_context(
  p_memory_id uuid,
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  seed_memory jsonb;
  related_memories jsonb := '[]'::jsonb;
BEGIN
  -- Get seed memory
  SELECT jsonb_build_object(
    'id', am.id, 'key', am.key, 'category', am.category,
    'content', am.content, 'tags', am.tags, 'source', am.source,
    'importance_score', am.importance_score, 'created_at', am.created_at
  ) INTO seed_memory
  FROM public.agent_memory am
  WHERE am.id = p_memory_id AND am.workspace_id = p_workspace_id;

  IF seed_memory IS NULL THEN RETURN NULL; END IF;

  -- Get 1-hop related memories with relation metadata
  SELECT COALESCE(jsonb_agg(row_data ORDER BY confidence DESC), '[]'::jsonb)
  INTO related_memories
  FROM (
    -- Forward relations
    SELECT jsonb_build_object(
      'id', am.id, 'key', am.key, 'category', am.category,
      'content', LEFT(am.content, 500), 'relation_type', mr.relation_type::text,
      'confidence', mr.confidence, 'direction', 'outgoing'
    ) as row_data, mr.confidence
    FROM public.memory_relations mr
    JOIN public.agent_memory am ON am.id = mr.related_id
    WHERE mr.memory_id = p_memory_id
      AND mr.related_type = 'memory'
      AND mr.workspace_id = p_workspace_id
    UNION ALL
    -- Reverse relations
    SELECT jsonb_build_object(
      'id', am.id, 'key', am.key, 'category', am.category,
      'content', LEFT(am.content, 500), 'relation_type', mr.relation_type::text,
      'confidence', mr.confidence, 'direction', 'incoming'
    ) as row_data, mr.confidence
    FROM public.memory_relations mr
    JOIN public.agent_memory am ON am.id = mr.memory_id
    WHERE mr.related_id = p_memory_id
      AND mr.related_type = 'memory'
      AND mr.workspace_id = p_workspace_id
  ) sub;

  RETURN jsonb_build_object('memory', seed_memory, 'related', related_memories);
END;
$$;

-- RPC 3: find_contradictions — finds memory pairs with contradicts relation or same-key conflicts
CREATE OR REPLACE FUNCTION find_contradictions(
  p_workspace_id uuid,
  p_limit int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  contradictions jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
  INTO contradictions
  FROM (
    SELECT jsonb_build_object(
      'relation_id', mr.id,
      'memory_a', jsonb_build_object('id', a.id, 'key', a.key, 'content', LEFT(a.content, 300), 'category', a.category, 'created_at', a.created_at),
      'memory_b', jsonb_build_object('id', b.id, 'key', b.key, 'content', LEFT(b.content, 300), 'category', b.category, 'created_at', b.created_at),
      'confidence', mr.confidence,
      'is_auto_detected', mr.is_auto_detected
    ) as row_data
    FROM public.memory_relations mr
    JOIN public.agent_memory a ON a.id = mr.memory_id
    JOIN public.agent_memory b ON b.id = mr.related_id
    WHERE mr.relation_type = 'contradicts'
      AND mr.workspace_id = p_workspace_id
    ORDER BY mr.confidence DESC, mr.created_at DESC
    LIMIT p_limit
  ) sub;

  RETURN contradictions;
END;
$$;

-- RPC 4: get_supersession_chain — ordered chain of superseded memories for a key
CREATE OR REPLACE FUNCTION get_supersession_chain(
  p_key text,
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  chain jsonb := '[]'::jsonb;
BEGIN
  -- Find all memories with this key, ordered by version/creation time
  -- Include supersedes relations to show the chain
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', am.id, 'key', am.key, 'content', LEFT(am.content, 300),
    'version', am.version, 'created_at', am.created_at, 'is_archived', am.is_archived,
    'superseded_by', (
      SELECT mr.related_id FROM public.memory_relations mr
      WHERE mr.memory_id = am.id AND mr.relation_type = 'supersedes'
        AND mr.related_type = 'memory' AND mr.workspace_id = p_workspace_id
      LIMIT 1
    )
  ) ORDER BY am.created_at ASC), '[]'::jsonb)
  INTO chain
  FROM public.agent_memory am
  WHERE am.key = p_key AND am.workspace_id = p_workspace_id;

  RETURN chain;
END;
$$;
