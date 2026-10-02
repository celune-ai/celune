import { z } from 'zod';
import type { McpToolHandler } from '../../types';
import { textResult, errorResult } from '../../types';
import {
  workspaceOverrideSchema,
  resolveWorkspace,
  isResolveError,
} from '../../workspace-resolver';

export const searchCodeExamples: McpToolHandler = {
  name: 'search_code_examples',
  description:
    'Search code examples extracted from installed skills. Find patterns like "how does skill X handle rate limiting?" across all skills.',
  schema: z.object({
    ...workspaceOverrideSchema,
    query: z.string().describe('Natural language query about code patterns'),
    language: z.string().optional().describe('Filter by language (typescript, python, sql, bash)'),
    limit: z.number().optional().describe('Max results (default 10)'),
  }),
  scope: 'read',
  group: 'memory',
  async execute(params, { auth, supabase }) {
    const resolved = await resolveWorkspace(params, auth, supabase);
    if (isResolveError(resolved)) return resolved;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return errorResult('Error: Supabase configuration missing');
    }

    const queryText = params.query as string;
    const limit = (params.limit as number) ?? 10;

    try {
      const embResponse = await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ input: queryText }),
      });

      if (!embResponse.ok) {
        // Fallback: keyword-only search via FTS
        const { data } = await supabase
          .from('brain_code_examples')
          .select('id, code_block, language, summary, source_path')
          .eq('workspace_id', resolved.workspaceId)
          .textSearch('fts', queryText, { type: 'plain', config: 'english' })
          .limit(limit);
        return textResult(JSON.stringify(data ?? [], null, 2));
      }

      const { embeddings } = await embResponse.json();
      const { data, error } = await supabase.rpc('search_code_examples', {
        query_embedding: JSON.stringify(embeddings),
        query_text: queryText,
        filter_workspace_id: resolved.workspaceId,
        match_count: limit,
        filter_language: (params.language as string) ?? null,
      });

      if (error) {
        console.error('[mcp] search_code_examples error:', error.message);
        return errorResult('Error: Code example search failed');
      }
      return textResult(JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[mcp] search_code_examples error:', e instanceof Error ? e.message : e);
      return errorResult('Error: Code example search failed');
    }
  },
};
