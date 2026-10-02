-- ─────────────────────────────────────────────────────────────────────────────
-- Slack Bot Tokens & Conversation Context
-- Slack App External Distribution — Sprint 1 (project 4a8e5017)
-- ─────────────────────────────────────────────────────────────────────────────
-- Extends slack_connections for full bot-token OAuth V2 (replaces webhook-only).
-- Creates slack_conversations for thread context persistence.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Extend slack_connections for bot tokens ─────────────────────────────

-- Bot token (encrypted at rest, same AES-256-GCM pattern as webhook URLs)
ALTER TABLE public.slack_connections
  ADD COLUMN IF NOT EXISTS bot_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS bot_token_iv TEXT;

-- Bot identity and metadata
ALTER TABLE public.slack_connections
  ADD COLUMN IF NOT EXISTS bot_user_id TEXT,
  ADD COLUMN IF NOT EXISTS installed_scopes TEXT[],
  ADD COLUMN IF NOT EXISTS app_id TEXT;

-- Map Slack install to Celune user (the user who installed, for multi-tenant)
ALTER TABLE public.slack_connections
  ADD COLUMN IF NOT EXISTS celune_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Distinguish webhook (legacy) vs bot (new) installations
ALTER TABLE public.slack_connections
  ADD COLUMN IF NOT EXISTS installation_type TEXT NOT NULL DEFAULT 'webhook';

-- Custom bot display name per workspace (shown on outgoing messages via chat:write.customize)
ALTER TABLE public.slack_connections
  ADD COLUMN IF NOT EXISTS bot_display_name TEXT,
  ADD COLUMN IF NOT EXISTS bot_icon_url TEXT;

-- Enterprise Grid future-proofing (low-cost columns now, defer org-level logic)
ALTER TABLE public.slack_connections
  ADD COLUMN IF NOT EXISTS slack_enterprise_id TEXT,
  ADD COLUMN IF NOT EXISTS is_enterprise_install BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.slack_connections.bot_token_encrypted IS
  'AES-256-GCM encrypted bot token (xoxb-). Format: "v1:<base64(ciphertext+authTag)>". Decrypted server-side only.';
COMMENT ON COLUMN public.slack_connections.bot_token_iv IS
  'Base64-encoded 12-byte IV for AES-256-GCM decryption of bot_token_encrypted.';
COMMENT ON COLUMN public.slack_connections.bot_user_id IS
  'Slack bot user ID (e.g., U12345). Used for filtering bot messages from event stream.';
COMMENT ON COLUMN public.slack_connections.installed_scopes IS
  'Array of OAuth scopes granted at install time. Used for capability checks.';
COMMENT ON COLUMN public.slack_connections.app_id IS
  'Slack app ID. Used for event routing and verification.';
COMMENT ON COLUMN public.slack_connections.celune_user_id IS
  'Celune user who installed the Slack app. For multi-tenant user mapping and audit.';
COMMENT ON COLUMN public.slack_connections.installation_type IS
  'webhook = legacy incoming-webhook only, bot = full bot token with events/commands.';

-- Revoke direct SELECT on secret bot token columns from authenticated role
REVOKE SELECT (bot_token_encrypted, bot_token_iv)
  ON public.slack_connections FROM authenticated;

-- Index for event processing: look up workspace by Slack team ID
CREATE INDEX IF NOT EXISTS slack_connections_team_active_idx
  ON public.slack_connections (slack_team_id, is_active)
  WHERE is_active = true;

-- ─── 2. slack_conversations — thread context for agent messaging ────────────

CREATE TABLE IF NOT EXISTS public.slack_conversations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slack_team_id   TEXT        NOT NULL,
  thread_ts       TEXT        NOT NULL,
  channel_id      TEXT        NOT NULL,
  user_slack_id   TEXT        NOT NULL,
  messages        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  agent_context   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  active_agent    TEXT,
  message_count   INTEGER     NOT NULL DEFAULT 0,
  last_activity   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slack_team_id, channel_id, thread_ts)
);

COMMENT ON TABLE public.slack_conversations IS
  'Per-thread conversation context for Slack agent messaging. One row per thread.';
COMMENT ON COLUMN public.slack_conversations.thread_ts IS
  'Slack thread timestamp — unique identifier for a conversation thread.';
COMMENT ON COLUMN public.slack_conversations.messages IS
  'JSONB array of {role, content, agent, ts} objects — conversation history for agent context.';
COMMENT ON COLUMN public.slack_conversations.agent_context IS
  'JSONB object with agent-specific state (current task, memory refs, etc.).';
COMMENT ON COLUMN public.slack_conversations.active_agent IS
  'Currently active agent in this thread (e.g., rick, sage, noir).';

-- ─── Indexes — slack_conversations ──────────────────────────────────────────

CREATE INDEX IF NOT EXISTS slack_conversations_workspace_idx
  ON public.slack_conversations (workspace_id);

CREATE INDEX IF NOT EXISTS slack_conversations_team_channel_idx
  ON public.slack_conversations (slack_team_id, channel_id);

CREATE INDEX IF NOT EXISTS slack_conversations_last_activity_idx
  ON public.slack_conversations (last_activity DESC);

-- ─── updated_at trigger — slack_conversations ───────────────────────────────

CREATE OR REPLACE FUNCTION public.update_slack_conversations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER slack_conversations_updated_at
  BEFORE UPDATE ON public.slack_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_slack_conversations_updated_at();

-- ─── RLS — slack_conversations ──────────────────────────────────────────────

ALTER TABLE public.slack_conversations ENABLE ROW LEVEL SECURITY;

-- Service role full access (for event processing workers)
CREATE POLICY "Service role full access on slack_conversations"
  ON public.slack_conversations
  FOR ALL
  USING (auth.role() = 'service_role');

-- Workspace members can view conversations in their workspace
CREATE POLICY "Workspace members can view slack conversations"
  ON public.slack_conversations
  FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_memberships
      WHERE user_id = auth.uid()
    )
  );

-- ─── Rollback ───────────────────────────────────────────────────────────────
-- To roll back this migration:
--
-- DROP TABLE IF EXISTS public.slack_conversations;
-- ALTER TABLE public.slack_connections
--   DROP COLUMN IF EXISTS bot_token_encrypted,
--   DROP COLUMN IF EXISTS bot_token_iv,
--   DROP COLUMN IF EXISTS bot_user_id,
--   DROP COLUMN IF EXISTS installed_scopes,
--   DROP COLUMN IF EXISTS app_id,
--   DROP COLUMN IF EXISTS celune_user_id,
--   DROP COLUMN IF EXISTS installation_type,
--   DROP COLUMN IF EXISTS slack_enterprise_id,
--   DROP COLUMN IF EXISTS is_enterprise_install;
-- DROP INDEX IF EXISTS slack_connections_team_active_idx;
