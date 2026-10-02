import { createHash } from 'crypto';
import type { Chunk } from './chunker';

export interface EmbeddingResult {
  embedding: number[];
  contentHash: string;
}

const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 512;
const MAX_BATCH_SIZE = 100;

/**
 * Generate embeddings for an array of chunks using OpenAI text-embedding-3-small.
 * Returns one EmbeddingResult per chunk (same order).
 *
 * Each chunk gets a SHA-256 content hash for dedup — callers can compare
 * hashes to skip re-embedding unchanged content.
 */
export async function generateEmbeddings(chunks: Chunk[]): Promise<EmbeddingResult[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY environment variable');
  }

  if (chunks.length === 0) return [];

  // Compute content hashes upfront
  const hashes = chunks.map((c) => hashContent(c.content));

  // Batch embed
  const allEmbeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += MAX_BATCH_SIZE) {
    const batch = chunks.slice(i, i + MAX_BATCH_SIZE);
    const embeddings = await callOpenAIEmbeddings(
      batch.map((c) => c.content),
      apiKey,
    );
    allEmbeddings.push(...embeddings);
  }

  return allEmbeddings.map((embedding, i) => ({
    embedding,
    contentHash: hashes[i]!,
  }));
}

/**
 * Compute SHA-256 hash of content for dedup.
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ---------------------------------------------------------------------------
// OpenAI API call via native fetch
// ---------------------------------------------------------------------------

async function callOpenAIEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: texts,
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

  // OpenAI returns embeddings sorted by index, but sort explicitly to be safe
  const sorted = data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);

  // Validate dimensions match expected (pgvector column must match).
  // Note: We only check the first embedding because OpenAI returns uniform
  // dimensions for all items in a single request (same model + dimensions param).
  // If a future provider returns mixed dimensions, extend this to check all items.
  if (sorted.length > 0 && sorted[0]!.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding dimension mismatch: expected ${EMBEDDING_DIMENSIONS}, got ${sorted[0]!.length}. Check model and pgvector column definition.`,
    );
  }

  return sorted;
}
