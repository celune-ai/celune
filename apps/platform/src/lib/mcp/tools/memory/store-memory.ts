import { z } from 'zod';
import type { McpToolHandler } from '../../types';
import { textResult, errorResult } from '../../types';
import {
  workspaceOverrideSchema,
  resolveWorkspace,
  isResolveError,
} from '../../workspace-resolver';

export const storeMemory: McpToolHandler = {
  name: 'store_memory',
  description:
    'Store a new memory. Auto-generates embedding for semantic search and auto-detects relations to existing memories (supports, contradicts, supersedes, elaborates).',
  schema: z.object({
    ...workspaceOverrideSchema,
    content: z.string().describe('The memory content to store'),
    category: z
      .string()
      .optional()
      .describe('Category: preference, decision, context, fact, general, handoff'),
    source: z.string().optional().describe('Source identifier (e.g., agent name)'),
    relates_to: z
      .array(
        z.object({
          memory_id: z.string().describe('ID of the related memory'),
          relation_type: z
            .enum([
              'supports',
              'contradicts',
              'supersedes',
              'elaborates',
              'depends_on',
              'derived_from',
              'context_for',
            ])
            .describe('Type of relation'),
        }),
      )
      .optional()
      .describe('Explicit relations to create with existing memories'),
  }),
  scope: 'write',
  group: 'memory',
  async execute(params, { auth, supabase }) {
    const resolved = await resolveWorkspace(params, auth, supabase);
    if (isResolveError(resolved)) return resolved;

    const key = `mcp:${Date.now()}`;
    const row = {
      key,
      content: params.content as string,
      category: (params.category as string) ?? 'general',
      source: (params.source as string) ?? 'mcp',
      memory_type: 'fact' as const,
      user_id: auth.userId,
      org_id: resolved.orgId,
      workspace_id: resolved.workspaceId,
    };
    const { data: inserted, error } = await supabase
      .from('agent_memory')
      .insert(row)
      .select('id')
      .single();
    if (error || !inserted) return errorResult('Error: Operation failed');

    // Create explicit relations if provided
    const relatesToParam = params.relates_to as
      Array<{ memory_id: string; relation_type: string }> | undefined;
    if (relatesToParam && relatesToParam.length > 0) {
      const relations = relatesToParam.map((r) => ({
        memory_id: inserted.id,
        related_type: 'memory' as const,
        related_id: r.memory_id,
        relation_type: r.relation_type,
        confidence: 1.0,
        workspace_id: resolved.workspaceId,
      }));
      void supabase.from('memory_relations').upsert(relations, {
        onConflict: 'memory_id,related_type,related_id,relation_type',
      });
    }

    // Generate and store embedding (fire-and-forget)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && serviceKey) {
      void fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ input: params.content }),
      })
        .then(async (res) => {
          if (res.ok) {
            const { embeddings } = await res.json();
            await supabase
              .from('agent_memory')
              .update({ embedding: JSON.stringify(embeddings) })
              .eq('key', key)
              .eq('user_id', auth.userId);
          }
        })
        .catch(() => {
          /* Fire-and-forget — embedding is supplementary */
        });
    }

    return textResult(`Memory stored: ${key}`);
  },
};
