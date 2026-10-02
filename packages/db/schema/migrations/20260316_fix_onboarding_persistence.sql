-- Fix onboarding chat memory/conversation persistence
-- Three bugs prevented onboarding data from being stored:
-- 1. agent_memory upsert used onConflict: 'workspace_id,key' but no unique constraint existed
--    (PostgREST requires a CONSTRAINT, not just a unique INDEX, for upsert)
-- 2. conversation_logs CHECK constraint didn't include 'onboarding' as a valid source
-- 3. generate-projects inserted 'source' column that doesn't exist on projects table (fixed in code)

-- Fix 1: Add unique constraint for workspace_id + key upserts
-- Drop any partial index first (earlier attempt created a partial unique index with WHERE clause)
DROP INDEX IF EXISTS agent_memory_workspace_key_unique;
ALTER TABLE agent_memory ADD CONSTRAINT agent_memory_workspace_key_unique UNIQUE (workspace_id, key);

-- Fix 2: Allow 'onboarding' as a conversation_logs source
ALTER TABLE conversation_logs DROP CONSTRAINT IF EXISTS conversation_logs_source_check;
ALTER TABLE conversation_logs ADD CONSTRAINT conversation_logs_source_check
  CHECK (source = ANY (ARRAY['web_chat', 'docs_chat', 'slack', 'api', 'agent', 'onboarding']));
