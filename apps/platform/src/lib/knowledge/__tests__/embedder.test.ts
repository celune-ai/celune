import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashContent, generateEmbeddings } from '../embedder';
import type { Chunk } from '../chunker';

describe('hashContent', () => {
  it('returns consistent SHA-256 hex hash', () => {
    const hash1 = hashContent('hello world');
    const hash2 = hashContent('hello world');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  it('returns different hashes for different content', () => {
    expect(hashContent('aaa')).not.toBe(hashContent('bbb'));
  });
});

describe('generateEmbeddings', () => {
  const mockChunks: Chunk[] = [
    { content: 'Hello world', title: null, chunkIndex: 0, charCount: 11 },
    { content: 'Second chunk', title: 'Section', chunkIndex: 1, charCount: 12 },
  ];

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('throws when OPENAI_API_KEY is missing', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    await expect(generateEmbeddings(mockChunks)).rejects.toThrow('Missing OPENAI_API_KEY');
  });

  it('returns empty array for empty chunks', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const result = await generateEmbeddings([]);
    expect(result).toEqual([]);
  });

  it('calls OpenAI API and returns embeddings with hashes', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');

    const mockEmbedding1 = Array.from({ length: 512 }, (_, i) => i * 0.001);
    const mockEmbedding2 = Array.from({ length: 512 }, (_, i) => i * 0.002);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { embedding: mockEmbedding1, index: 0 },
            { embedding: mockEmbedding2, index: 1 },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await generateEmbeddings(mockChunks);

    expect(result).toHaveLength(2);
    expect(result[0]!.embedding).toEqual(mockEmbedding1);
    expect(result[1]!.embedding).toEqual(mockEmbedding2);
    expect(result[0]!.contentHash).toBe(hashContent('Hello world'));
    expect(result[1]!.contentHash).toBe(hashContent('Second chunk'));

    // Verify API call
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.model).toBe('text-embedding-3-small');
    expect(body.dimensions).toBe(512);
    expect(body.input).toEqual(['Hello world', 'Second chunk']);
  });

  it('throws on API error', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('rate limited', { status: 429 }),
    );

    await expect(generateEmbeddings(mockChunks)).rejects.toThrow('OpenAI embeddings API error 429');
  });

  it('batches large chunk arrays', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');

    // Create 150 chunks (should be split into 2 batches: 100 + 50)
    const manyChunks: Chunk[] = Array.from({ length: 150 }, (_, i) => ({
      content: `Chunk ${i}`,
      title: null,
      chunkIndex: i,
      charCount: 7,
    }));

    const mockResponse = (count: number) =>
      new Response(
        JSON.stringify({
          data: Array.from({ length: count }, (_, i) => ({
            embedding: Array.from({ length: 512 }, () => 0.1),
            index: i,
          })),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse(100))
      .mockResolvedValueOnce(mockResponse(50));

    const result = await generateEmbeddings(manyChunks);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(150);
  });
});
