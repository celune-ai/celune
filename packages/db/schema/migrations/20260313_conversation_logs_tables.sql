-- ─────────────────────────────────────────────────────────────────────────────
-- Conversation logs + messages tables
-- Support Hub — Separation & Permission Gating (task b4eebbdc)
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── conversation_logs ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversation_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  workspace_id    UUID,
  session_id      TEXT,
  source          TEXT        NOT NULL DEFAULT 'web_chat'
                  CHECK (source IN ('web_chat', 'docs_chat', 'slack', 'api', 'agent', 'onboarding')),
  agent_id        TEXT,
  title           TEXT,
  summary         TEXT,
  message_count   INT                  DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'resolved', 'escalated', 'archived')),
  metadata        JSONB,
  started_at      TIMESTAMPTZ          DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS conversation_logs_user_id_idx      ON conversation_logs (user_id);
CREATE INDEX IF NOT EXISTS conversation_logs_workspace_id_idx ON conversation_logs (workspace_id);
CREATE INDEX IF NOT EXISTS conversation_logs_status_idx       ON conversation_logs (status);
CREATE INDEX IF NOT EXISTS conversation_logs_source_idx       ON conversation_logs (source);
CREATE INDEX IF NOT EXISTS conversation_logs_created_at_idx   ON conversation_logs (created_at DESC);

-- ─── updated_at trigger ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_conversation_logs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER conversation_logs_updated_at
  BEFORE UPDATE ON conversation_logs
  FOR EACH ROW EXECUTE FUNCTION update_conversation_logs_updated_at();

-- ─── Row-Level Security ───────────────────────────────────────────────────────

ALTER TABLE conversation_logs ENABLE ROW LEVEL SECURITY;

-- All writes go through service-role API routes (support chat, agent systems).
-- No INSERT policy for authenticated users — deny by default is intentional.

-- Users can view their own conversations
CREATE POLICY "Users can view own conversations"
  ON conversation_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- Service role has full unrestricted access
CREATE POLICY "Service role full access"
  ON conversation_logs
  FOR ALL
  USING (auth.role() = 'service_role');

-- ─── conversation_messages ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversation_messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES conversation_logs(id) ON DELETE CASCADE,
  role            TEXT        NOT NULL
                  CHECK (role IN ('user', 'assistant', 'system')),
  content         TEXT        NOT NULL,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS conversation_messages_conv_id_idx    ON conversation_messages (conversation_id);
CREATE INDEX IF NOT EXISTS conversation_messages_created_at_idx ON conversation_messages (created_at);

-- ─── Row-Level Security ───────────────────────────────────────────────────────

ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;

-- Users can view messages from their own conversations
CREATE POLICY "Users can view own conversation messages"
  ON conversation_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversation_logs
      WHERE conversation_logs.id = conversation_messages.conversation_id
        AND conversation_logs.user_id = auth.uid()
    )
  );

-- Service role has full unrestricted access
CREATE POLICY "Service role full access"
  ON conversation_messages
  FOR ALL
  USING (auth.role() = 'service_role');
