export const MEMORY_CATEGORIES = [
  'preference',
  'decision',
  'context',
  'fact',
  'general',
  'handoff',
  'episode',
  'pattern',
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_TYPES = [
  'fact',
  'preference',
  'decision',
  'context',
  'episode',
  'handoff',
  'pattern',
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface AgentMemory {
  id: string;
  key: string;
  category: MemoryCategory;
  content: string;
  tags: string;
  source: string;
  version: number;
  user_id: string;
  org_id: string | null;
  workspace_id: string | null;
  agent_id: string;
  memory_type: MemoryType;
  embedding_model: string | null;
  importance_score: number;
  access_count: number;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  is_core: boolean;
  /** Short summary (≤500 chars) for search result previews */
  abstract: string | null;
  /** L1 overview for large memories — compressed representation */
  overview: string | null;
  /** Archived memories are hidden from default queries */
  is_archived: boolean;
}
