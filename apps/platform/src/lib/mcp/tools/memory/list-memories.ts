import { z } from 'zod';
import type { McpToolHandler } from '../../types';
import { textResult, errorResult } from '../../types';
import {
  workspaceOverrideSchema,
  resolveWorkspace,
  isResolveError,
} from '../../workspace-resolver';

export const listMemories: McpToolHandler = {
  name: 'list_memories',
  description: 'List recent memories, optionally filtered by category',
  schema: z.object({
    ...workspaceOverrideSchema,
    category: z
      .string()
      .optional()
      .describe('Filter: preference, decision, context, fact, general, handoff'),
    limit: z.number().optional().describe('Max results (default 20)'),
  }),
  scope: 'read',
  group: 'memory',
  async execute(params, { auth, supabase }) {
    const resolved = await resolveWorkspace(params, auth, supabase);
    if (isResolveError(resolved)) return resolved;

    let query = supabase
      .from('agent_memory')
      .select('id, key, content, category, source, tags, memory_type, importance_score, created_at')
      .eq('workspace_id', resolved.workspaceId)
      .order('updated_at', { ascending: false })
      .limit((params.limit as number) ?? 20);
    if (params.category) query = query.eq('category', params.category as string);
    const { data, error } = await query;
    if (error) return errorResult('Error: Operation failed');
    return textResult(JSON.stringify(data, null, 2));
  },
};
