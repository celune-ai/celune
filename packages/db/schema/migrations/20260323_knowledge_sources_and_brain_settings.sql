-- Migration: Knowledge sources + workspace brain settings
-- Part of: Brain Intelligence Upgrade — Sprint 3
-- Tasks: 0b7f310c (web crawling) + 577557d9 (RAG settings)

-- =============================================================================
-- 1. knowledge_sources — URLs, sitemaps, GitHub repos as brain knowledge
-- =============================================================================

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Source configuration
  source_type text NOT NULL CHECK (source_type IN ('url', 'sitemap', 'github_repo')),
  url text NOT NULL,
  name text,  -- user-friendly label
  -- Crawl configuration
  crawl_config jsonb DEFAULT '{}'::jsonb,
  -- Status tracking
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'crawling', 'complete', 'failed', 'paused')),
  last_crawled_at timestamptz,
  last_error text,
  -- Stats
  pages_crawled integer DEFAULT 0,
  chunks_created integer DEFAULT 0,
  -- Lifecycle
  is_active boolean DEFAULT true,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_sources_workspace
  ON knowledge_sources(workspace_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_sources_active
  ON knowledge_sources(workspace_id) WHERE is_active = true;

-- Prevent duplicate URLs per workspace
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_sources_workspace_url
  ON knowledge_sources(workspace_id, url);

-- RLS
ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_sources_workspace_read ON knowledge_sources
  FOR SELECT USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_memberships wm WHERE wm.user_id = auth.uid()
    )
  );

CREATE POLICY knowledge_sources_service_all ON knowledge_sources
  FOR ALL USING (auth.role() = 'service_role');


-- =============================================================================
-- 2. brain_settings JSONB on workspaces
-- =============================================================================
-- Workspace-level brain configuration: toggle hybrid search, set weights, etc.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS brain_settings jsonb DEFAULT '{
    "hybrid_search": true,
    "vector_weight": 0.7,
    "keyword_weight": 0.3,
    "reranking": false,
    "embedding_model": "gte-small",
    "auto_crawl_interval_hours": 24
  }'::jsonb;

COMMENT ON COLUMN workspaces.brain_settings IS
  'Workspace-level brain configuration: hybrid_search toggle, search weights, '
  'embedding model preference, reranking, and crawl interval.';
