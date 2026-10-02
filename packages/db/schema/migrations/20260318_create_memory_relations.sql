-- Bidirectional memory-to-entity relations
CREATE TABLE IF NOT EXISTS memory_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES agent_memory(id) ON DELETE CASCADE,
  related_type text NOT NULL CHECK (related_type IN ('task', 'skill', 'memory')),
  related_id uuid NOT NULL,
  relation_type text NOT NULL DEFAULT 'related', -- related, derived_from, context_for, etc.
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for both lookup directions
CREATE INDEX IF NOT EXISTS idx_memory_relations_memory_id ON memory_relations(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_relations_related ON memory_relations(related_type, related_id);
CREATE INDEX IF NOT EXISTS idx_memory_relations_workspace ON memory_relations(workspace_id);

-- Unique constraint to prevent duplicate relations
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_relations_unique
  ON memory_relations(memory_id, related_type, related_id);

-- RLS
ALTER TABLE memory_relations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view memory relations in their workspace"
  ON memory_relations FOR SELECT
  USING (workspace_id IN (
    SELECT wm.workspace_id FROM workspace_memberships wm WHERE wm.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert memory relations in their workspace"
  ON memory_relations FOR INSERT
  WITH CHECK (workspace_id IN (
    SELECT wm.workspace_id FROM workspace_memberships wm WHERE wm.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete memory relations in their workspace"
  ON memory_relations FOR DELETE
  USING (workspace_id IN (
    SELECT wm.workspace_id FROM workspace_memberships wm WHERE wm.user_id = auth.uid()
  ));
