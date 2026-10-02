import { createServiceClient } from '@repo/db/service';
import type { ContentFormat } from './normalize';
import { normalizeToMarkdown } from './normalize';
import { chunkContent, type Chunk } from './chunker';
import { generateEmbeddings, hashContent } from './embedder';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestDocument {
  externalId: string;
  title: string;
  content: string;
  format: ContentFormat;
  metadata?: Record<string, unknown>;
}

export interface IngestParams {
  sourceId: string;
  workspaceId: string;
  documents: IngestDocument[];
}

export interface IngestResult {
  processed: number;
  added: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Ingest content from a knowledge source into the knowledge_items table.
 *
 * Flow per document:
 *   1. Normalize content to markdown
 *   2. Chunk the markdown
 *   3. Hash each chunk — skip unchanged ones
 *   4. Generate embeddings for new/changed chunks
 *   5. Upsert to knowledge_items
 *
 * Errors on individual documents are collected, not thrown — the batch
 * continues processing remaining documents.
 */
export async function ingestContent(params: IngestParams): Promise<IngestResult> {
  const { sourceId, workspaceId, documents } = params;
  const supabase = createServiceClient();

  const result: IngestResult = {
    processed: 0,
    added: 0,
    updated: 0,
    unchanged: 0,
    errors: [],
  };

  for (const doc of documents) {
    try {
      await ingestDocument(supabase, sourceId, workspaceId, doc, result);
      result.processed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`[${doc.externalId}] ${message}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Per-document ingestion
// ---------------------------------------------------------------------------

async function ingestDocument(
  supabase: ReturnType<typeof createServiceClient>,
  sourceId: string,
  workspaceId: string,
  doc: IngestDocument,
  result: IngestResult,
): Promise<void> {
  // 1. Normalize
  const markdown = normalizeToMarkdown(doc.content, doc.format);
  if (!markdown.trim()) return;

  // 2. Chunk
  const chunks = chunkContent(markdown);
  if (chunks.length === 0) return;

  // 3. Hash check — fetch existing hashes for this document's chunks
  const existingHashes = await getExistingHashes(supabase, sourceId, doc.externalId);

  // 4. Determine which chunks need embedding
  const chunksWithHashes = chunks.map((chunk) => ({
    chunk,
    contentHash: hashContent(chunk.content),
  }));

  const unchangedIndices = new Set<number>();
  const chunksToEmbed: Chunk[] = [];
  const embedIndices: number[] = [];

  for (let i = 0; i < chunksWithHashes.length; i++) {
    const { contentHash } = chunksWithHashes[i]!;
    if (existingHashes.has(contentHash)) {
      unchangedIndices.add(i);
      result.unchanged++;
    } else {
      chunksToEmbed.push(chunksWithHashes[i]!.chunk);
      embedIndices.push(i);
    }
  }

  if (chunksToEmbed.length === 0) return;

  // 5. Generate embeddings for new/changed chunks
  const embeddings = await generateEmbeddings(chunksToEmbed);

  // 6. Upsert to knowledge_items
  const rows = embedIndices.map((originalIdx, embIdx) => {
    const { chunk, contentHash } = chunksWithHashes[originalIdx]!;
    const { embedding } = embeddings[embIdx]!;

    return {
      source_id: sourceId,
      workspace_id: workspaceId,
      external_id: doc.externalId,
      chunk_index: chunk.chunkIndex,
      title: doc.title,
      section_title: chunk.title,
      content: chunk.content,
      content_hash: contentHash,
      embedding: JSON.stringify(embedding),
      char_count: chunk.charCount,
      metadata: doc.metadata ? JSON.stringify(doc.metadata) : null,
    };
  });

  // Upsert in batches of 50 to avoid payload limits
  const UPSERT_BATCH = 50;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase.from('knowledge_items').upsert(batch, {
      onConflict: 'source_id,external_id,chunk_index',
    });

    if (error) {
      throw new Error(`Supabase upsert failed: ${error.message}`);
    }
  }

  // Count adds vs updates — if there were existing hashes for this doc,
  // changed chunks are updates; otherwise they're adds
  const isExistingDoc = existingHashes.size > 0;
  if (isExistingDoc) {
    result.updated += embedIndices.length;
  } else {
    result.added += embedIndices.length;
  }

  // Clean up stale chunks (chunks that no longer exist for this document)
  const currentChunkCount = chunks.length;
  await supabase
    .from('knowledge_items')
    .delete()
    .eq('source_id', sourceId)
    .eq('external_id', doc.externalId)
    .gte('chunk_index', currentChunkCount);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getExistingHashes(
  supabase: ReturnType<typeof createServiceClient>,
  sourceId: string,
  externalId: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from('knowledge_items')
    .select('content_hash')
    .eq('source_id', sourceId)
    .eq('external_id', externalId);

  if (!data) return new Set();
  return new Set(data.map((row) => row.content_hash as string));
}
