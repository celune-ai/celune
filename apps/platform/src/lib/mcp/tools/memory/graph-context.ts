import { z } from 'zod';
import type { McpToolHandler } from '../../types';
import { textResult, errorResult } from '../../types';
import {
  workspaceOverrideSchema,
  resolveWorkspace,
  isResolveError,
} from '../../workspace-resolver';

export const graphContext: McpToolHandler = {
  name: 'graph_context',
  description:
    'Retrieve connected knowledge graph context around a seed memory. Returns the memory with its related memories (supports, contradicts, supersedes, elaborates) for richer context assembly.',
  schema: z.object({
    ...workspaceOverrideSchema,
    memory_id: z.string().uuid().describe('ID of the seed memory to explore'),
    depth: z
      .number()
      .min(1)
      .max(5)
      .optional()
      .describe('How many hops to traverse (default 2, max 5)'),
  }),
  scope: 'read',
  group: 'memory',
  async execute(params, { auth, supabase }) {
    const resolved = await resolveWorkspace(params, auth, supabase);
    if (isResolveError(resolved)) return resolved;

    const memoryId = params.memory_id as string;
    const depth = (params.depth as number) ?? 2;

    try {
      const { data, error } = await supabase.rpc('get_memory_graph', {
        p_memory_id: memoryId,
        p_depth: depth,
        p_workspace_id: resolved.workspaceId,
      });

      if (error) {
        console.error('[mcp] graph_context rpc error:', error.message);
        return errorResult('Error: Graph traversal failed');
      }

      // Validate RPC response shape
      if (!data || typeof data !== 'object') {
        return textResult('No graph data found for this memory.');
      }
      const graph = data as Record<string, unknown>;
      const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
      const edges = Array.isArray(graph.edges) ? graph.edges : [];
      if (nodes.length === 0) {
        return textResult('No graph data found for this memory.');
      }

      return textResult(JSON.stringify({ nodes, edges }, null, 2));
    } catch (e) {
      console.error('[mcp] graph_context error:', e instanceof Error ? e.message : e);
      return errorResult('Error: Graph context retrieval failed');
    }
  },
};
