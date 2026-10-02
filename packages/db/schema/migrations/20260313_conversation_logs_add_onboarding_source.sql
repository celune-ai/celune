-- Add 'onboarding' as a valid source for conversation_logs
-- Used by POST /api/onboarding/chat to persist conversation audit trail

ALTER TABLE IF EXISTS conversation_logs
  DROP CONSTRAINT IF EXISTS conversation_logs_source_check;

ALTER TABLE IF EXISTS conversation_logs
  ADD CONSTRAINT conversation_logs_source_check
  CHECK (source IN ('web_chat', 'docs_chat', 'slack', 'api', 'agent', 'onboarding'));
