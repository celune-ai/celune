import { z } from 'zod';
import type { McpToolHandler } from '../../types';
import { textResult, errorResult } from '../../types';
import {
  workspaceOverrideSchema,
  resolveWorkspace,
  isResolveError,
} from '../../workspace-resolver';

interface MemoryResult {
  id: string;
  key?: string;
  content?: string;
  category?: string;
  [key: string]: unknown;
}

interface RelationRow {
  relation_type: string;
  confidence: number;
  related_key: string;
}

async function enrichWithRelations(
  supabase: {
    rpc: (
      name: string,
      params: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>;
  },
  memories: MemoryResult[],
  workspaceId: string,
): Promise<MemoryResult[]> {
  if (memories.length === 0) return memories;

  const enriched = await Promise.all(
    memories.map(async (mem) => {
      try {
        const { data } = await supabase.rpc('get_memory_context', {
          p_memory_id: mem.id,
          p_workspace_id: workspaceId,
        });
        const ctx = data as { related?: RelationRow[] } | null;
        if (ctx?.related && Array.isArray(ctx.related) && ctx.related.length > 0) {
          const summaries = ctx.related
            .slice(0, 5)
            .map(
              (r: RelationRow) =>
                `${r.relation_type} → ${r.related_key ?? 'unknown'} (${Math.round((r.confidence ?? 1) * 100)}%)`,
            );
          return { ...mem, relations: summaries };
        }
      } catch {
        // Non-fatal — return without relations
      }
      return mem;
    }),
  );
  return enriched;
}

export const recallMemory: McpToolHandler = {
  name: 'recall_memory',
  description:
    'Graph-aware memory search: combines semantic similarity with keyword matching, enriched with knowledge graph relations (supports, contradicts, supersedes, elaborates)',
  schema: z.object({
    ...workspaceOverrideSchema,
    query: z.string().describe('Natural language search query'),
    threshold: z.number().optional().describe('Similarity threshold 0-1 (default 0.5)'),
    limit: z.number().optional().describe('Max results (default 10)'),
    search_mode: z
      .enum(['hybrid', 'vector', 'keyword'])
      .optional()
      .describe('Search mode: hybrid (default), vector-only, or keyword-only'),
    include_relations: z
      .boolean()
      .optional()
      .describe('Include 1-hop relation summaries per result (default true)'),
  }),
  scope: 'read',
  group: 'memory',
  async execute(params, { auth, supabase }) {
    const resolved = await resolveWorkspace(params, auth, supabase);
    if (isResolveError(resolved)) return resolved;

    const includeRelations = (params.include_relations as boolean) !== false;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return errorResult('Error: Supabase configuration missing');
    }

    const mode = (params.search_mode as string) ?? 'hybrid';
    const queryText = params.query as string;
    const limit = (params.limit as number) ?? 10;
    const threshold = (params.threshold as number) ?? 0.5;

    try {
      // Keyword-only mode: skip embedding generation
      if (mode === 'keyword') {
        const { data } = await supabase
          .from('agent_memory')
          .select('id, key, content, category, source, tags, created_at')
          .eq('workspace_id', resolved.workspaceId)
          .eq('is_archived', false)
          .textSearch('fts', queryText, { type: 'plain', config: 'english' })
          .limit(limit);
        const results = (data ?? []) as MemoryResult[];
        const enriched = includeRelations
          ? await enrichWithRelations(supabase as never, results, resolved.workspaceId)
          : results;
        return textResult(JSON.stringify(enriched, null, 2));
      }

      // Generate embedding for vector or hybrid search
      const embResponse = await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ input: queryText }),
      });
      if (!embResponse.ok) {
        // Fallback to keyword search if embedding fails
        const { data } = await supabase
          .from('agent_memory')
          .select('id, key, content, category, source, tags, created_at')
          .eq('workspace_id', resolved.workspaceId)
          .eq('is_archived', false)
          .ilike('content', `%${queryText.replace(/[%_]/g, '\\$&')}%`)
          .limit(limit);
        return textResult(JSON.stringify(data ?? [], null, 2));
      }
      const { embeddings } = await embResponse.json();

      if (mode === 'hybrid') {
        const { data: wsData } = await supabase
          .from('workspaces')
          .select('brain_settings')
          .eq('id', resolved.workspaceId)
          .single();
        const brainSettings = (wsData?.brain_settings ?? {}) as Record<string, unknown>;
        const vectorWeight = (brainSettings.vector_weight as number) ?? 0.7;
        const keywordWeight = (brainSettings.keyword_weight as number) ?? 0.3;

        const { data, error } = await supabase.rpc('hybrid_brain_search', {
          query_embedding: JSON.stringify(embeddings),
          query_text: queryText,
          filter_workspace_id: resolved.workspaceId,
          match_count: limit,
          p_vector_weight: vectorWeight,
          p_keyword_weight: keywordWeight,
        });
        if (error) {
          console.error('[mcp] recall_memory hybrid error:', error.message);
          const fallback = await supabase.rpc('match_memories', {
            query_embedding: JSON.stringify(embeddings),
            match_threshold: threshold,
            match_count: limit,
            filter_workspace_id: resolved.workspaceId,
          });
          const fbResults = (fallback.data ?? []) as MemoryResult[];
          const fbEnriched = includeRelations
            ? await enrichWithRelations(supabase as never, fbResults, resolved.workspaceId)
            : fbResults;
          return textResult(JSON.stringify(fbEnriched, null, 2));
        }
        const hybridResults = (data ?? []) as MemoryResult[];
        const hybridEnriched = includeRelations
          ? await enrichWithRelations(supabase as never, hybridResults, resolved.workspaceId)
          : hybridResults;
        return textResult(JSON.stringify(hybridEnriched, null, 2));
      }

      // Vector-only mode
      const { data, error } = await supabase.rpc('match_memories', {
        query_embedding: JSON.stringify(embeddings),
        match_threshold: threshold,
        match_count: limit,
        filter_user_id: auth.userId,
        filter_org_id: resolved.orgId,
        filter_workspace_id: resolved.workspaceId,
      });
      if (error) {
        console.error('[mcp] recall_memory rpc error:', error.message);
        return errorResult('Error: Memory search failed');
      }
      const vectorResults = (data ?? []) as MemoryResult[];
      const vectorEnriched = includeRelations
        ? await enrichWithRelations(supabase as never, vectorResults, resolved.workspaceId)
        : vectorResults;
      return textResult(JSON.stringify(vectorEnriched, null, 2));
    } catch (e) {
      console.error('[mcp] recall_memory error:', e instanceof Error ? e.message : e);
      return errorResult('Error: Memory search failed');
    }
  },
};
