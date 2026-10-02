-- Fails when the vector search functions error or rank wrongly. Recall falls back to keyword
-- search when hybrid_brain_search raises, so a broken function goes unnoticed in the app.
-- The CI schema job runs it after a fresh boot:
--   psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f packages/db/scripts/check-vector-search.sql
--
-- Seeds two workspaces in a transaction, calls hybrid_brain_search, match_memories, and
-- search_code_examples, checks order and workspace scoping, then rolls back.

BEGIN;

DO $check$
DECLARE
  dims integer;
  e1 extensions.vector;
  e12 extensions.vector;
  e2 extensions.vector;
  owner_id uuid := gen_random_uuid();
  org_id uuid := gen_random_uuid();
  ws_a uuid := gen_random_uuid();
  ws_b uuid := gen_random_uuid();
  got text[];
BEGIN
  SELECT a.atttypmod INTO dims
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.agent_memory'::regclass AND a.attname = 'embedding';

  -- Unit vectors: e1 is the query, e12 sits 45 degrees away, e2 is orthogonal.
  SELECT ('[' || string_agg(CASE WHEN i = 1 THEN '1' ELSE '0' END, ',' ORDER BY i) || ']')::extensions.vector,
         ('[' || string_agg(CASE WHEN i <= 2 THEN '0.7071' ELSE '0' END, ',' ORDER BY i) || ']')::extensions.vector,
         ('[' || string_agg(CASE WHEN i = 2 THEN '1' ELSE '0' END, ',' ORDER BY i) || ']')::extensions.vector
    INTO e1, e12, e2
  FROM generate_series(1, dims) AS i;

  INSERT INTO auth.users (id, email) VALUES (owner_id, 'vector-check-' || owner_id || '@example.test');
  INSERT INTO public.organizations (id, name, slug, owner_id)
    VALUES (org_id, 'Vector check', 'vector-check-' || org_id, owner_id);
  INSERT INTO public.workspaces (id, org_id, name, slug) VALUES
    (ws_a, org_id, 'A', 'vector-check-a-' || ws_a),
    (ws_b, org_id, 'B', 'vector-check-b-' || ws_b);

  INSERT INTO public.agent_memory (workspace_id, key, content, embedding) VALUES
    (ws_a, 'exact', 'Deploys run from the main branch.', e1),
    (ws_a, 'near', 'The zephyr queue retries deploys.', e12),
    (ws_a, 'keyword-only', 'Zephyr workers drain at midnight.', e2),
    (ws_b, 'other-workspace', 'Deploys run from the main branch. Zephyr.', e1);

  SELECT array_agg(r.key ORDER BY r.combined_score DESC) INTO got
  FROM public.hybrid_brain_search(e1, 'zephyr', ws_a) r;
  IF got IS DISTINCT FROM ARRAY['exact', 'near', 'keyword-only'] THEN
    RAISE EXCEPTION 'hybrid_brain_search returned %, expected {exact,near,keyword-only}', got;
  END IF;

  SELECT array_agg(r.key ORDER BY r.final_score DESC) INTO got
  FROM public.match_memories(e1, 0.5, 20, filter_workspace_id => ws_a) r;
  IF got IS DISTINCT FROM ARRAY['exact', 'near'] THEN
    RAISE EXCEPTION 'match_memories returned %, expected {exact,near}', got;
  END IF;

  INSERT INTO public.brain_code_examples (workspace_id, code_block, summary, embedding) VALUES
    (ws_a, 'git push origin main', 'Deploy from main.', e1),
    (ws_a, 'zephyr retry --all', 'Retry the zephyr queue.', e12),
    (ws_a, 'echo unrelated', 'Unrelated.', e2),
    (ws_b, 'git push origin main', 'Other workspace.', e1);

  SELECT array_agg(r.summary ORDER BY r.combined_score DESC) INTO got
  FROM public.search_code_examples(e1, 'zephyr', ws_a) r;
  IF got IS DISTINCT FROM ARRAY['Deploy from main.', 'Retry the zephyr queue.'] THEN
    RAISE EXCEPTION 'search_code_examples returned %, expected {Deploy from main.,Retry the zephyr queue.}', got;
  END IF;

  RAISE NOTICE 'vector search: hybrid_brain_search, match_memories, search_code_examples rank and scope correctly';
END;
$check$;

ROLLBACK;
