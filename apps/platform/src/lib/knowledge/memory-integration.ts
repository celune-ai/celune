import { createServiceClient } from '@repo/db/service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KnowledgeResult {
  id: string;
  title: string;
  sectionTitle: string | null;
  content: string;
  similarity: number;
  sourceAttribution: string;
  metadata: Record<string, unknown> | null;
}

interface KnowledgeRow {
  id: string;
  title: string;
  section_title: string | null;
  content: string;
  similarity: number;
  source_type: string | null;
  source_name: string | null;
  metadata: string | null;
}

// ---------------------------------------------------------------------------
// Source attribution labels
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<string, string> = {
  notion: 'Notion',
  github: 'GitHub',
  'google-drive': 'Google Drive',
  gmail: 'Gmail',
  linear: 'Linear',
  asana: 'Asana',
  confluence: 'Confluence',
  dropbox: 'Dropbox',
  figma: 'Figma',
  'google-calendar': 'Google Calendar',
  upload: 'File Upload',
  'url-crawl': 'URL',
};

function formatSourceAttribution(sourceType: string | null, sourceName: string | null): string {
  if (!sourceType) return '[from Knowledge Base]';
  const label = SOURCE_LABELS[sourceType] ?? sourceType;
  if (sourceName) return `[from ${label}: ${sourceName}]`;
  return `[from ${label}]`;
}

// ---------------------------------------------------------------------------
// Embedding generation — reuses the same OpenAI model as embedder.ts
// ---------------------------------------------------------------------------

const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 512;

async function generateQueryEmbedding(query: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY environment variable');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: [query],
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => 'unknown');
    throw new Error(`OpenAI embeddings API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
  };

  return data.data[0]!.embedding;
}

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

/**
 * Search the knowledge base (knowledge_items) for a workspace using vector
 * cosine similarity. Results include source attribution so agents can cite
 * where information came from.
 *
 * This function is designed to be called alongside agent memory search
 * (recall_memory) to blend KB results into the agent's context.
 */
export async function searchKnowledgeForAgent(
  workspaceId: string,
  query: string,
  limit: number = 5,
): Promise<KnowledgeResult[]> {
  const embedding = await generateQueryEmbedding(query);
  const supabase = createServiceClient();

  // Use pgvector cosine similarity via Supabase RPC or direct query.
  // We query knowledge_items joined with knowledge_sources for attribution.
  const { data, error } = await supabase.rpc('match_knowledge_items', {
    query_embedding: JSON.stringify(embedding),
    filter_workspace_id: workspaceId,
    match_count: limit,
    match_threshold: 0.3,
  });

  if (error) {
    // Fallback: direct query without RPC if the function doesn't exist yet
    console.error('[knowledge] match_knowledge_items RPC error:', error.message);
    return searchKnowledgeFallback(supabase, workspaceId, query, limit);
  }

  const rows = (data ?? []) as KnowledgeRow[];
  return rows.map(mapRowToResult);
}

// ---------------------------------------------------------------------------
// Fallback — keyword search if vector RPC is unavailable
// ---------------------------------------------------------------------------

async function searchKnowledgeFallback(
  supabase: ReturnType<typeof createServiceClient>,
  workspaceId: string,
  query: string,
  limit: number,
): Promise<KnowledgeResult[]> {
  // Simple ilike search as a last resort
  const { data } = await supabase
    .from('knowledge_items')
    .select(
      `
      id,
      title,
      section_title,
      content,
      source_id,
      metadata
    `,
    )
    .eq('workspace_id', workspaceId)
    .ilike('content', `%${query.replace(/[%_]/g, '\\$&')}%`)
    .limit(limit);

  if (!data || data.length === 0) return [];

  // Fetch source info for attribution
  const sourceIds = [...new Set(data.map((r) => r.source_id))];
  const { data: sources } = await supabase
    .from('knowledge_sources')
    .select('id, source_type, name')
    .in('id', sourceIds);

  const sourceMap = new Map(
    (sources ?? []).map((s) => [s.id, { type: s.source_type, name: s.name }]),
  );

  return data.map((row) => {
    const source = sourceMap.get(row.source_id);
    return {
      id: row.id,
      title: row.title,
      sectionTitle: row.section_title,
      content: row.content,
      similarity: 0, // No similarity score in fallback
      sourceAttribution: formatSourceAttribution(source?.type ?? null, source?.name ?? null),
      metadata: row.metadata
        ? typeof row.metadata === 'string'
          ? JSON.parse(row.metadata)
          : row.metadata
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapRowToResult(row: KnowledgeRow): KnowledgeResult {
  return {
    id: row.id,
    title: row.title,
    sectionTitle: row.section_title,
    content: row.content,
    similarity: row.similarity,
    sourceAttribution: formatSourceAttribution(row.source_type, row.source_name),
    metadata: row.metadata
      ? typeof row.metadata === 'string'
        ? JSON.parse(row.metadata)
        : row.metadata
      : null,
  };
}
