-- Add realtime_enabled flag to api_keys
-- When enabled, the MCP server subscribes to the SSE stream for live workspace events
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS realtime_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN api_keys.realtime_enabled IS 'When true, MCP connections with this key receive real-time workspace events via SSE stream';
