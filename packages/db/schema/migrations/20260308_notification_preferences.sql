-- ─────────────────────────────────────────────────────────────────────────────
-- Notification Preferences & Slack Connections
-- Sprint 1 — Comms Platform Integration (task 067d890b)
-- ─────────────────────────────────────────────────────────────────────────────
-- Two tables:
--   1. slack_connections — one row per Celune workspace (Slack OAuth connection)
--   2. notification_preferences — per-user, per-workspace, per-channel settings
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. slack_connections ────────────────────────────────────────────────────
-- Stores the Slack Incoming Webhook URL and team info for a Celune workspace.
-- One active connection per workspace. Admin role required to create/delete.

CREATE TABLE IF NOT EXISTS public.slack_connections (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slack_team_id       TEXT        NOT NULL,
  slack_team_name     TEXT        NOT NULL,
  slack_channel       TEXT,       -- default channel name e.g. '#general'
  slack_channel_id    TEXT,       -- Slack channel ID
  incoming_webhook_url TEXT       NOT NULL,  -- stored as-is; treat as secret
  connected_by        UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slack_team_id)
);

COMMENT ON TABLE  public.slack_connections IS
  'Workspace-level Slack OAuth connections. One active connection per workspace.';
COMMENT ON COLUMN public.slack_connections.incoming_webhook_url IS
  'Slack Incoming Webhook URL. Treat as a secret — never expose to clients. Stored unencrypted; encrypt at rest via Supabase Vault in Phase 2.';
COMMENT ON COLUMN public.slack_connections.connected_by IS
  'The user who performed the OAuth connection. For audit trail only.';

-- ─── Indexes — slack_connections ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS slack_connections_workspace_id_idx
  ON public.slack_connections (workspace_id);

CREATE INDEX IF NOT EXISTS slack_connections_active_idx
  ON public.slack_connections (workspace_id)
  WHERE is_active = true;

-- ─── updated_at trigger — slack_connections ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_slack_connections_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER slack_connections_updated_at
  BEFORE UPDATE ON public.slack_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_slack_connections_updated_at();

-- ─── RLS — slack_connections ──────────────────────────────────────────────────

ALTER TABLE public.slack_connections ENABLE ROW LEVEL SECURITY;

-- Workspace members can read their workspace's Slack connection (to show status)
CREATE POLICY "Workspace members can view slack connections"
  ON public.slack_connections
  FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_memberships
      WHERE user_id = auth.uid()
    )
  );

-- Only workspace admins/owners can insert connections
-- workspace_memberships.role became role_id in 20260306, so the hosted project
-- carries one admin policy built on the RBAC v2 helpers.
DROP POLICY IF EXISTS "Workspace admins can manage slack connections" ON public.slack_connections;
CREATE POLICY "Workspace admins can manage slack connections"
  ON public.slack_connections
  FOR ALL
  USING (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
    AND (is_owner() OR user_has_permission(auth.uid(), workspace_id, 'settings:write'))
  );

-- Service role full access (for notification dispatch service)
CREATE POLICY "Service role full access on slack_connections"
  ON public.slack_connections
  FOR ALL
  USING (auth.role() = 'service_role');

-- ─── 2. notification_preferences ─────────────────────────────────────────────
-- Per-user, per-workspace, per-channel notification settings.
-- One row per (user_id, workspace_id, channel) combination.

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id    UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel         TEXT        NOT NULL
                  CHECK (channel IN ('slack', 'email', 'discord', 'teams', 'telegram')),
  event_types     TEXT[]      NOT NULL DEFAULT ARRAY['task.completed', 'task.blocked'],
  slack_channel   TEXT,       -- e.g. '#deployments' or Slack channel ID
  email_address   TEXT,       -- defaults to account email at send time if null
  frequency       TEXT        NOT NULL DEFAULT 'immediate'
                  CHECK (frequency IN ('immediate', 'digest_daily', 'digest_weekly', 'off')),
  is_enabled      BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, workspace_id, channel)
);

COMMENT ON TABLE  public.notification_preferences IS
  'Per-user, per-workspace notification channel preferences. One row per (user, workspace, channel).';
COMMENT ON COLUMN public.notification_preferences.event_types IS
  'Array of event type strings this preference applies to. e.g. ARRAY[''task.completed'', ''task.blocked'']';
COMMENT ON COLUMN public.notification_preferences.frequency IS
  'How often to deliver: immediate (on event), digest_daily, digest_weekly, or off (disable channel).';

-- ─── Indexes — notification_preferences ──────────────────────────────────────

CREATE INDEX IF NOT EXISTS notification_preferences_user_workspace_idx
  ON public.notification_preferences (user_id, workspace_id);

CREATE INDEX IF NOT EXISTS notification_preferences_workspace_channel_idx
  ON public.notification_preferences (workspace_id, channel)
  WHERE is_enabled = true;

-- ─── updated_at trigger — notification_preferences ───────────────────────────

CREATE OR REPLACE FUNCTION public.update_notification_preferences_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_notification_preferences_updated_at();

-- ─── RLS — notification_preferences ──────────────────────────────────────────

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Users can read their own preferences
CREATE POLICY "Users can view own notification preferences"
  ON public.notification_preferences
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own preferences
CREATE POLICY "Users can create own notification preferences"
  ON public.notification_preferences
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own preferences
CREATE POLICY "Users can update own notification preferences"
  ON public.notification_preferences
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own preferences
CREATE POLICY "Users can delete own notification preferences"
  ON public.notification_preferences
  FOR DELETE
  USING (auth.uid() = user_id);

-- Service role full access (for notification dispatch and admin overrides)
CREATE POLICY "Service role full access on notification_preferences"
  ON public.notification_preferences
  FOR ALL
  USING (auth.role() = 'service_role');
