-- SECURITY DEFINER functions run as their owner and skip RLS. These take a workspace, user, org,
-- or row id from the caller and do not check auth.uid(), so any role that can execute them can
-- read or change another tenant's data (transfer_org_ownership, search_knowledge_items,
-- publish_vault_memories, match_memories, and the rest below). The app calls all of them through
-- the service client after its own authorization checks, so user roles lose EXECUTE here.
-- Also pins search_path on the four that had none.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.cleanup_expired_memories()',
    'public.cleanup_rate_limits()',
    'public.cleanup_ward_fix_log(integer)',
    'public.get_employed_agents(uuid)',
    'public.get_memory_ttl_days(uuid)',
    'public.hybrid_brain_search(extensions.vector, text, uuid, integer, double precision, double precision, text, text, boolean)',
    'public.increment_referral_count(text, integer)',
    'public.match_memories(extensions.vector, double precision, integer, text, text, uuid, uuid, uuid, boolean)',
    'public.publish_vault_memories(uuid[], uuid, uuid)',
    'public.rate_limit_check(text, integer)',
    'public.resolve_user_permissions(uuid, uuid)',
    'public.rollup_usage_summaries(text, integer)',
    'public.search_code_examples(extensions.vector, text, uuid, integer, text)',
    'public.search_knowledge_items(uuid, text, integer, uuid[])',
    'public.sum_usage_events(uuid, timestamp with time zone)',
    'public.touch_memories(uuid[])',
    'public.transfer_org_ownership(uuid, uuid, uuid)'
  ] LOOP
    -- Skip functions an older database never created.
    IF to_regprocedure(fn) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;

  FOREACH fn IN ARRAY ARRAY[
    'public.cleanup_ward_fix_log(integer)',
    'public.get_memory_ttl_days(uuid)',
    'public.publish_vault_memories(uuid[], uuid, uuid)',
    'public.search_knowledge_items(uuid, text, integer, uuid[])'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', fn);
    END IF;
  END LOOP;
END;
$$;
