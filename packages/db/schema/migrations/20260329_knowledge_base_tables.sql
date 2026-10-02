-- Migration: Knowledge base tables for connector integrations
--
-- Three tables supporting the knowledge base feature:
-- 1. knowledge_sources — connected accounts (Notion, GitHub, GDrive, etc.)
-- 2. knowledge_items — indexed content chunks with vector embeddings
-- 3. knowledge_syncs — audit trail for sync operations

-- Enable pgvector if not already
CREATE EXTENSION IF NOT EXISTS vector;

-- Knowledge sources (connected accounts)
CREATE TABLE knowledge_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,  -- 'notion', 'github', 'gdrive', 'slack', 'linear', 'confluence', 'asana', 'upload', 'url'
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'connecting', 'syncing', 'active', 'error', 'paused', 'disconnected'
  config JSONB NOT NULL DEFAULT '{}',  -- encrypted OAuth tokens via Nango connection_id, scope selections
  nango_connection_id TEXT,  -- Nango's connection identifier
  items_count INTEGER NOT NULL DEFAULT 0,
  storage_bytes BIGINT NOT NULL DEFAULT 0,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  sync_frequency_hours INTEGER NOT NULL DEFAULT 4,
  created_by UUID,  -- user who created this source
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Knowledge items (indexed content chunks)
CREATE TABLE knowledge_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  external_id TEXT,  -- Provider's document/page ID for dedup
  title TEXT,
  content TEXT NOT NULL,
  embedding vector(512),  -- text-embedding-3-small at 512 dims (cost savings)
  content_hash TEXT,  -- SHA-256 for change detection
  section_title TEXT,  -- Heading/section title within parent document
  chunk_index INTEGER DEFAULT 0,  -- Position within parent document
  char_count INTEGER DEFAULT 0,  -- Character count for this chunk
  metadata JSONB DEFAULT '{}',  -- source_url, author, last_modified, content_type
  importance_score FLOAT DEFAULT 0.5,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sync history (audit trail)
-- NOTE: code references this as "knowledge_syncs" — keep table name in sync
CREATE TABLE knowledge_syncs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL,  -- 'running', 'completed', 'failed'
  items_synced INTEGER DEFAULT 0,
  items_failed INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  triggered_by UUID,  -- user who triggered the sync
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_knowledge_sources_workspace ON knowledge_sources(workspace_id);
DO $$
BEGIN
  -- 20260323_knowledge_sources_and_brain_settings.sql creates knowledge_sources without provider.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'knowledge_sources' AND column_name = 'provider'
  ) THEN
    CREATE INDEX idx_knowledge_sources_provider ON knowledge_sources(workspace_id, provider);
  END IF;
END $$;
CREATE INDEX idx_knowledge_items_source ON knowledge_items(source_id);
CREATE INDEX idx_knowledge_items_workspace ON knowledge_items(workspace_id);
CREATE INDEX idx_knowledge_items_hash ON knowledge_items(source_id, content_hash);
CREATE INDEX idx_knowledge_items_external ON knowledge_items(source_id, external_id);
CREATE INDEX idx_knowledge_sync_source ON knowledge_syncs(source_id, created_at DESC);

-- Unique constraint required for upsert in ingest.ts
CREATE UNIQUE INDEX idx_knowledge_items_upsert
  ON knowledge_items(source_id, external_id, chunk_index);

-- pgvector index (ivfflat for cosine similarity)
CREATE INDEX idx_knowledge_items_embedding ON knowledge_items
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- RLS
ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_syncs ENABLE ROW LEVEL SECURITY;

-- Service role: full access
CREATE POLICY "knowledge_sources_service_all" ON knowledge_sources
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "knowledge_items_service_all" ON knowledge_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "knowledge_syncs_service_all" ON knowledge_syncs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users: read own workspace data
CREATE POLICY "knowledge_sources_select_workspace" ON knowledge_sources
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

CREATE POLICY "knowledge_items_select_workspace" ON knowledge_items
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (SELECT user_workspace_ids(auth.uid()))
  );

CREATE POLICY "knowledge_syncs_select_workspace" ON knowledge_syncs
  FOR SELECT
  TO authenticated
  USING (
    source_id IN (
      SELECT id FROM knowledge_sources
      WHERE workspace_id IN (SELECT user_workspace_ids(auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- Vector search RPC (used by /api/knowledge/search)
-- SECURITY DEFINER so it can query via service role while still filtering
-- by workspace_id passed from the authenticated API route.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION search_knowledge_items(
  p_workspace_id UUID,
  p_embedding TEXT,    -- JSON-encoded float[] from the API
  p_limit INT DEFAULT 10,
  p_source_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  source_id UUID,
  title TEXT,
  section_title TEXT,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ki.id,
    ki.source_id,
    ki.title,
    ki.section_title,
    ki.content,
    ki.metadata,
    1 - (ki.embedding <=> p_embedding::vector) AS similarity
  FROM knowledge_items ki
  WHERE ki.workspace_id = p_workspace_id
    AND ki.embedding IS NOT NULL
    AND (p_source_ids IS NULL OR ki.source_id = ANY(p_source_ids))
  ORDER BY ki.embedding <=> p_embedding::vector
  LIMIT p_limit;
END;
$$;
