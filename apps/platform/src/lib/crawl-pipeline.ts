/**
 * Knowledge source crawl pipeline.
 *
 * Fetches a URL, extracts text content, chunks it, and stores each chunk
 * as an agent_memory entry with source='crawl:<knowledge_source_id>'.
 *
 * For sitemaps: parses XML to extract URLs, then crawls each.
 * For github_repo: fetches README only (future: tree walking).
 */

import type { createServiceClient } from '@repo/db/service';
import { fireAndForgetEmbedding } from '@/lib/memory-helpers';
import * as cheerio from 'cheerio';

type SupabaseClient = ReturnType<typeof createServiceClient>;

const MAX_CONTENT_LENGTH = 500_000; // 500KB text limit per page

/** Blocked hostnames and IP ranges to prevent SSRF. */
function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Only allow http/https schemes
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;

    const hostname = parsed.hostname.toLowerCase();

    // Block localhost variants
    if (hostname === 'localhost' || hostname === '[::1]') return true;

    // Block private/reserved IP ranges
    const ipParts = hostname.split('.').map(Number);
    if (ipParts.length === 4 && ipParts.every((n) => !isNaN(n))) {
      if (ipParts[0] === 127) return true; // 127.0.0.0/8
      if (ipParts[0] === 10) return true; // 10.0.0.0/8
      if (ipParts[0] === 172 && ipParts[1] >= 16 && ipParts[1] <= 31) return true; // 172.16.0.0/12
      if (ipParts[0] === 192 && ipParts[1] === 168) return true; // 192.168.0.0/16
      if (ipParts[0] === 169 && ipParts[1] === 254) return true; // 169.254.0.0/16 (link-local/IMDS)
      if (ipParts[0] === 0) return true; // 0.0.0.0/8
    }

    // Block cloud metadata endpoints
    if (hostname === 'metadata.google.internal') return true;

    return false;
  } catch {
    return true; // Invalid URL = blocked
  }
}
const CHUNK_SIZE = 1500; // chars per chunk (~375 tokens for gte-small)
const CHUNK_OVERLAP = 200;

interface CrawlConfig {
  max_pages?: number;
  include_patterns?: string[];
  exclude_patterns?: string[];
}

interface CrawlResult {
  pages_crawled: number;
  chunks_created: number;
  errors: string[];
}

/** Extract readable text from HTML using cheerio for reliable parsing. */
function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  // Remove non-content elements
  $('script, style, nav, footer, header, noscript, iframe, svg').remove();
  // Extract text from body (or root if no body)
  const text = $('body').length ? $('body').text() : $.root().text();
  return text.replace(/\s+/g, ' ').trim();
}

/** Split text into overlapping chunks at sentence boundaries. */
function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + CHUNK_SIZE;
    if (end >= text.length) {
      chunks.push(text.slice(start).trim());
      break;
    }

    // Find sentence boundary near chunk end
    const segment = text.slice(start, end + 100);
    const sentenceEnd = segment.lastIndexOf('. ', CHUNK_SIZE);
    if (sentenceEnd > CHUNK_SIZE * 0.6) {
      end = start + sentenceEnd + 2;
    }

    chunks.push(text.slice(start, end).trim());
    start = end - CHUNK_OVERLAP;
  }

  return chunks.filter((c) => c.length > 50);
}

/** Fetch a single URL and return text content. Blocks private/internal URLs (SSRF protection). */
async function fetchPage(url: string): Promise<string | null> {
  if (isBlockedUrl(url)) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'CeluneBrainCrawler/1.0',
        Accept: 'text/html, application/xhtml+xml, text/plain, text/markdown',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') ?? '';
    const raw = await res.text();

    if (raw.length > MAX_CONTENT_LENGTH) return null;

    if (contentType.includes('text/html') || contentType.includes('xhtml')) {
      return htmlToText(raw);
    }

    // Plain text or markdown — return as-is
    return raw;
  } catch {
    return null;
  }
}

/** Parse a sitemap XML and extract <loc> URLs. */
function parseSitemapUrls(xml: string): string[] {
  const urls: string[] = [];
  const locRegex = /<loc>\s*(.*?)\s*<\/loc>/gi;
  let match;
  while ((match = locRegex.exec(xml)) !== null) {
    const url = match[1];
    if (url && url.startsWith('http')) urls.push(url);
  }
  return urls;
}

/** Check if a URL matches include/exclude patterns. */
function matchesPatterns(url: string, config: CrawlConfig): boolean {
  if (config.include_patterns?.length) {
    const included = config.include_patterns.some((p) => url.includes(p));
    if (!included) return false;
  }
  if (config.exclude_patterns?.length) {
    const excluded = config.exclude_patterns.some((p) => url.includes(p));
    if (excluded) return false;
  }
  return true;
}

/** Store text chunks as agent_memory entries with fire-and-forget embedding. */
async function storeChunks(
  supabase: SupabaseClient,
  workspaceId: string,
  sourceId: string,
  pageUrl: string,
  chunks: string[],
): Promise<number> {
  // Batch upsert all chunks in one DB call
  const rows = chunks.map((chunk, i) => ({
    key: `crawl:${sourceId}:${pageUrl}:chunk-${i}`,
    content: chunk,
    category: 'knowledge',
    memory_type: 'knowledge',
    source: `crawl:${sourceId}`,
    importance_score: 0.5,
    workspace_id: workspaceId,
    is_archived: false,
    is_core: false,
    tags: ['crawled', 'knowledge-source'],
    metadata: { source_url: pageUrl, chunk_index: i, total_chunks: chunks.length },
  }));

  const { data, error } = await supabase
    .from('agent_memory')
    .upsert(rows, { onConflict: 'key' })
    .select('id, key');

  if (error) {
    console.error('[crawl-pipeline] Batch upsert error:', error.message);
    return 0;
  }

  const stored = data?.length ?? 0;

  // Fire-and-forget: trigger embedding generation for stored chunks
  if (data) {
    for (const row of data) {
      const chunk = chunks.find((_, i) => row.key.endsWith(`chunk-${i}`));
      if (chunk) {
        fireAndForgetEmbedding(supabase, row.id, chunk);
      }
    }
  }

  return stored;
}

/** Main crawl pipeline for a single knowledge source. */
export async function crawlKnowledgeSource(
  supabase: SupabaseClient,
  sourceId: string,
  workspaceId: string,
  sourceType: string,
  url: string,
  config: CrawlConfig = {},
): Promise<CrawlResult> {
  const result: CrawlResult = { pages_crawled: 0, chunks_created: 0, errors: [] };
  const maxPages = config.max_pages ?? 50;

  try {
    if (sourceType === 'sitemap') {
      // Fetch sitemap XML, extract URLs, crawl each
      const sitemapContent = await fetchPage(url);
      if (!sitemapContent) {
        result.errors.push(`Failed to fetch sitemap: ${url}`);
        return result;
      }

      let urls = parseSitemapUrls(sitemapContent);
      urls = urls.filter((u) => matchesPatterns(u, config)).slice(0, maxPages);

      for (const pageUrl of urls) {
        const text = await fetchPage(pageUrl);
        if (!text || text.length < 50) {
          result.errors.push(`Empty or failed: ${pageUrl}`);
          continue;
        }

        const chunks = chunkText(text);
        const stored = await storeChunks(supabase, workspaceId, sourceId, pageUrl, chunks);
        result.pages_crawled++;
        result.chunks_created += stored;
      }
    } else if (sourceType === 'github_repo') {
      // Fetch README from GitHub repo — try main first, fallback to master
      const repoUrl = url.replace(/\/$/, '');
      const rawBase = repoUrl.replace('github.com', 'raw.githubusercontent.com');
      let text = await fetchPage(`${rawBase}/main/README.md`);
      if (!text || text.length < 50) {
        text = await fetchPage(`${rawBase}/master/README.md`);
      }
      if (text && text.length >= 50) {
        const chunks = chunkText(text);
        const stored = await storeChunks(supabase, workspaceId, sourceId, url, chunks);
        result.pages_crawled = 1;
        result.chunks_created = stored;
      } else {
        result.errors.push(`Failed to fetch README from: ${url}`);
      }
    } else {
      // Single URL crawl
      const text = await fetchPage(url);
      if (!text || text.length < 50) {
        result.errors.push(`Failed to fetch or empty content: ${url}`);
        return result;
      }

      const chunks = chunkText(text);
      const stored = await storeChunks(supabase, workspaceId, sourceId, url, chunks);
      result.pages_crawled = 1;
      result.chunks_created = stored;
    }
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  return result;
}
