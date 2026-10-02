-- Add is_core flag to agent_memory for system-seeded memories that cannot be deleted
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS is_core BOOLEAN NOT NULL DEFAULT false;

-- Mark existing system starter memories as core
UPDATE agent_memory
SET is_core = true
WHERE source = 'system'
  AND key LIKE 'getting-started:%';
