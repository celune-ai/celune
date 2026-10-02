import { z } from 'zod';

/** Shared memory entry validation — used by POST /entries and PATCH /entries/[id] */
export const memoryContentSchema = z.object({
  content: z.string().max(10000, 'content must be 10,000 characters or fewer').optional(),
  category: z.string().max(200).optional(),
  tags: z.string().max(500, 'tags must be 500 characters or fewer').optional(),
  key: z.string().max(200).optional(),
  is_archived: z.boolean().optional(),
});

export const memorySearchSchema = z.object({
  q: z.string().min(1).max(500, 'search query must be 500 characters or fewer'),
  category: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const MEMORY_RELATION_TYPES = [
  'supports',
  'contradicts',
  'supersedes',
  'elaborates',
  'depends_on',
  'derived_from',
  'context_for',
] as const;

export type MemoryRelationType = (typeof MEMORY_RELATION_TYPES)[number];

const memoryRelationSchema = z.object({
  type: z.enum(['task', 'skill', 'memory']),
  id: z.string().uuid(),
  relation_type: z.enum(MEMORY_RELATION_TYPES).default('elaborates'),
  confidence: z.number().min(0).max(1).optional(),
});

export const createMemorySchema = memoryContentSchema.extend({
  content: z.string().min(1).max(10000, 'content must be 10,000 characters or fewer'),
  key: z.string().min(1).max(200),
  source: z.enum(['user', 'system', 'agent']).optional(),
  workspace_id: z.string().uuid().nullable().optional(),
  agent_id: z.string().max(100).nullable().optional(),
  memory_type: z.string().max(100).optional(),
  importance_score: z.number().min(0).max(100).optional(),
  related_to: z.array(memoryRelationSchema).max(10).optional(),
});

export type CreateMemoryInput = z.infer<typeof createMemorySchema>;
