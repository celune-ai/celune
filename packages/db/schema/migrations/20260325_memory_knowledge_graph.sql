-- Memory Knowledge Graph: upgrade memory_relations with typed enum + confidence
-- Supports: supports, contradicts, supersedes, elaborates, depends_on, derived_from, context_for

-- Step 1: Create the relation type enum
DO $$ BEGIN
  CREATE TYPE memory_relation_type AS ENUM (
    'supports',
    'contradicts',
    'supersedes',
    'elaborates',
    'depends_on',
    'derived_from',
    'context_for'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 2: Migrate existing free-form relation_type to enum
-- Add new typed column, migrate data, drop old column, rename
ALTER TABLE memory_relations ADD COLUMN IF NOT EXISTS relation_type_enum memory_relation_type;

-- Migrate existing values to closest enum match
UPDATE memory_relations SET relation_type_enum = CASE
  WHEN relation_type = 'supports' THEN 'supports'::memory_relation_type
  WHEN relation_type = 'contradicts' THEN 'contradicts'::memory_relation_type
  WHEN relation_type = 'supersedes' THEN 'supersedes'::memory_relation_type
  WHEN relation_type = 'elaborates' THEN 'elaborates'::memory_relation_type
  WHEN relation_type = 'depends_on' THEN 'depends_on'::memory_relation_type
  WHEN relation_type = 'derived_from' THEN 'derived_from'::memory_relation_type
  WHEN relation_type = 'context_for' THEN 'context_for'::memory_relation_type
  ELSE 'elaborates'::memory_relation_type  -- default for 'related' and other free-form
END
WHERE relation_type_enum IS NULL;

-- Set default and not-null
ALTER TABLE memory_relations ALTER COLUMN relation_type_enum SET DEFAULT 'elaborates'::memory_relation_type;
ALTER TABLE memory_relations ALTER COLUMN relation_type_enum SET NOT NULL;

-- Drop old text column and rename
ALTER TABLE memory_relations DROP COLUMN IF EXISTS relation_type;
ALTER TABLE memory_relations RENAME COLUMN relation_type_enum TO relation_type;

-- Step 3: Add confidence and auto-detection columns
ALTER TABLE memory_relations ADD COLUMN IF NOT EXISTS confidence float NOT NULL DEFAULT 1.0
  CHECK (confidence >= 0.0 AND confidence <= 1.0);
ALTER TABLE memory_relations ADD COLUMN IF NOT EXISTS is_auto_detected boolean NOT NULL DEFAULT false;
ALTER TABLE memory_relations ADD COLUMN IF NOT EXISTS detected_by text;

-- Step 4: Add composite index for graph traversal queries
CREATE INDEX IF NOT EXISTS idx_memory_relations_type_confidence
  ON memory_relations(relation_type, confidence DESC);

-- Add reverse lookup index (find all memories that relate TO a given memory)
CREATE INDEX IF NOT EXISTS idx_memory_relations_reverse
  ON memory_relations(related_id, related_type) WHERE related_type = 'memory';

-- Step 5: Update unique constraint to include relation_type (allow multiple typed relations)
DROP INDEX IF EXISTS idx_memory_relations_unique;
CREATE UNIQUE INDEX idx_memory_relations_unique
  ON memory_relations(memory_id, related_type, related_id, relation_type);

-- Rollback:
-- ALTER TABLE memory_relations DROP COLUMN IF EXISTS confidence;
-- ALTER TABLE memory_relations DROP COLUMN IF EXISTS is_auto_detected;
-- ALTER TABLE memory_relations DROP COLUMN IF EXISTS detected_by;
-- ALTER TABLE memory_relations ADD COLUMN relation_type text NOT NULL DEFAULT 'related';
-- DROP TYPE IF EXISTS memory_relation_type;
