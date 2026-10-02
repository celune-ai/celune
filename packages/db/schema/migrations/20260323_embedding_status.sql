-- Track embedding generation status on agent_memory
-- Enables monitoring of failed embeddings that degrade semantic search.
--
-- Follow-up from PR #108 retro

ALTER TABLE agent_memory
  ADD COLUMN IF NOT EXISTS embedding_status TEXT DEFAULT 'none'
  CHECK (embedding_status IN ('none', 'pending', 'complete', 'failed'));

-- Index for admin queries: find memories with failed embeddings
CREATE INDEX IF NOT EXISTS idx_agent_memory_embedding_status
  ON agent_memory (embedding_status)
  WHERE embedding_status = 'failed';
