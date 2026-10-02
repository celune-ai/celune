-- Add voice_settings JSONB column to agent_configs for per-agent voice configuration
-- Shape: { provider: string, voice_id: string, voice_name: string, params: { stability: number, similarity_boost: number, style: number } }

ALTER TABLE agent_configs
ADD COLUMN IF NOT EXISTS voice_settings jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN agent_configs.voice_settings IS 'Per-agent voice configuration: provider, voice_id, voice_name, and TTS params (stability, similarity_boost, style)';
