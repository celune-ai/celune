-- Migration: Fix UNIQUE(key) → UNIQUE(key, user_id) + HNSW index
-- Sprint 1, Task 2: CRITICAL multi-tenant bug fix
--
-- The current UNIQUE(key) prevents two users from storing a memory with the
-- same key. This WILL break silently when a second user signs up.
--
-- Depends on: 20260307_agent_memory_multitenant_columns.sql (embedding column exists)

-- Drop the dangerous global unique constraint
ALTER TABLE agent_memory DROP CONSTRAINT IF EXISTS agent_memory_key_key;

-- Add per-user unique constraint (two users can have the same key)
ALTER TABLE agent_memory
  ADD CONSTRAINT agent_memory_key_user_unique UNIQUE (key, user_id);

-- Create HNSW index for fast approximate nearest neighbor search
-- Only indexes rows that actually have embeddings (sparse index)
-- m=16: connections per node (default, good balance of speed vs recall)
-- ef_construction=64: build-time search width (higher = better recall, slower build)
CREATE INDEX IF NOT EXISTS agent_memory_embedding_hnsw
  ON agent_memory
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL;

-- Composite index for the primary query pattern:
-- WHERE user_id = $1 AND org_id = $2 AND embedding IS NOT NULL
-- B-tree prefilter runs BEFORE HNSW scan for efficiency
CREATE INDEX IF NOT EXISTS idx_agent_memory_user_org_embedding
  ON agent_memory(user_id, org_id)
  WHERE embedding IS NOT NULL;
