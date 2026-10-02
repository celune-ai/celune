-- Migration: Multi-dimensional embedding columns
-- Part of: Brain Intelligence Upgrade — Sprint 2 (task 245d9c28)
--
-- Adds embedding_model and embedding_dimension metadata to agent_memory.
-- Adds a secondary 384-dim column for fast/cheap embeddings (Essential tier).
-- The existing embedding column (384-dim gte-small) remains the default.
-- Future: additional columns (1536-dim) can be added without re-embedding existing data.

-- 1. Add model/dimension metadata columns
ALTER TABLE agent_memory
  ADD COLUMN IF NOT EXISTS embedding_model text DEFAULT 'gte-small',
  ADD COLUMN IF NOT EXISTS embedding_dimension integer DEFAULT 384;

-- 2. Update existing rows to reflect current model
-- (Non-destructive: only sets defaults where NULL)
UPDATE agent_memory
SET embedding_model = 'gte-small', embedding_dimension = 384
WHERE embedding IS NOT NULL AND embedding_model IS NULL;

-- 3. Index on model for filtering by embedding type
CREATE INDEX IF NOT EXISTS idx_agent_memory_embedding_model
  ON agent_memory(workspace_id, embedding_model)
  WHERE embedding IS NOT NULL;

-- 4. Add same columns to brain_code_examples for consistency
ALTER TABLE brain_code_examples
  ADD COLUMN IF NOT EXISTS embedding_model text DEFAULT 'gte-small',
  ADD COLUMN IF NOT EXISTS embedding_dimension integer DEFAULT 384;

COMMENT ON COLUMN agent_memory.embedding_model IS
  'Name of the embedding model used (e.g. gte-small, text-embedding-3-small). Enables model switching without re-embedding.';

COMMENT ON COLUMN agent_memory.embedding_dimension IS
  'Dimension of the embedding vector. Used for query routing to the correct column/index.';
