-- Add client_metadata to api_keys for storing MCP client identity
-- Captured from MCP initialize messages (clientInfo) and User-Agent headers

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS client_metadata jsonb DEFAULT NULL;

COMMENT ON COLUMN api_keys.client_metadata IS 'MCP client identity: { name, version, user_agent, updated_at }';
