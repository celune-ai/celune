-- Extend agent_configs to support full dynamic agent definitions
-- Adds display metadata, persona, capabilities, and plan tier tracking

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_configs' AND column_name = 'display_name') THEN
    ALTER TABLE agent_configs ADD COLUMN display_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_configs' AND column_name = 'role') THEN
    ALTER TABLE agent_configs ADD COLUMN role TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_configs' AND column_name = 'description') THEN
    ALTER TABLE agent_configs ADD COLUMN description TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_configs' AND column_name = 'agent_type') THEN
    ALTER TABLE agent_configs ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'ai' CHECK (agent_type IN ('ai', 'human'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_configs' AND column_name = 'model') THEN
    ALTER TABLE agent_configs ADD COLUMN model TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_configs' AND column_name = 'color') THEN
    ALTER TABLE agent_configs ADD COLUMN color TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_configs' AND column_name = 'icon') THEN
    ALTER TABLE agent_configs ADD COLUMN icon TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_configs' AND column_name = 'capabilities') THEN
    ALTER TABLE agent_configs ADD COLUMN capabilities JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_configs' AND column_name = 'is_active') THEN
    ALTER TABLE agent_configs ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_configs' AND column_name = 'persona_prompt') THEN
    ALTER TABLE agent_configs ADD COLUMN persona_prompt TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_configs' AND column_name = 'created_at') THEN
    ALTER TABLE agent_configs ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
END $$;

-- Index for workspace agent listing
CREATE INDEX IF NOT EXISTS idx_agent_configs_workspace_active
  ON agent_configs(workspace_id, is_active);
