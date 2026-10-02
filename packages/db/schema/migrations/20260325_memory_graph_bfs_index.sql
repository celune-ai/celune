-- Composite index for BFS graph traversal pattern
-- The BFS inner loop queries: WHERE memory_id = ANY($1) AND related_type = 'memory'
-- This composite index avoids scanning the single-column memory_id index + filter
CREATE INDEX IF NOT EXISTS idx_memory_relations_memory_id_type
  ON memory_relations(memory_id, related_type);
