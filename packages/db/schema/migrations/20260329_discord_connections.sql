-- Discord bot user linking table
-- Maps Discord user IDs to Celune workspace/user pairs
CREATE TABLE IF NOT EXISTS discord_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  discord_guild_id TEXT,
  discord_username TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, discord_user_id)
);

-- Index for fast lookup by discord user
CREATE INDEX IF NOT EXISTS idx_discord_connections_discord_user
  ON discord_connections(discord_user_id) WHERE is_active = true;

-- RLS
ALTER TABLE discord_connections ENABLE ROW LEVEL SECURITY;

-- Service role has full access
CREATE POLICY "Service role full access" ON discord_connections
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Users can read/manage their own connections
CREATE POLICY "Users manage own discord connections" ON discord_connections
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
