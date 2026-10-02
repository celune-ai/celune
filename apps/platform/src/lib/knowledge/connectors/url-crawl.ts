import * as cheerio from 'cheerio';
import { ingestContent, type IngestResult, type IngestDocument } from '../ingest';
import type { ContentFormat } from '../normalize';

const MAX_DEPTH = 3;
const MAX_PAGES = 100;
const FETCH_TIMEOUT_MS = 10_000;

interface CrawlParams {
  sourceId: string;
  workspaceId: string;
  baseUrl: string;
}

// ---------------------------------------------------------------------------
// Robots.txt check (basic)
// ---------------------------------------------------------------------------

async function isAllowed(baseUrl: string, path: string): Promise<boolean> {
  try {
    const robotsUrl = new URL('/robots.txt', baseUrl).toString();
    if (isBlockedUrl(robotsUrl)) return true; // Skip robots check for blocked URLs
    const res = await fetch(robotsUrl, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return true; // No robots.txt = allowed

    const text = await res.text();
    const lines = text.split('\n');
    let inUserAgent = false;

    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      if (trimmed.startsWith('user-agent:')) {
        const agent = trimmed.split(':')[1]?.trim();
        inUserAgent = agent === '*';
      } else if (inUserAgent && trimmed.startsWith('disallow:')) {
        const disallowed = trimmed.split(':')[1]?.trim();
        if (disallowed && path.startsWith(disallowed)) return false;
      }
    }
  } catch {
    // Can't fetch robots.txt — allow
  }
  return true;
}

// ---------------------------------------------------------------------------
// SSRF blocklist — prevent fetching internal/metadata URLs
// ---------------------------------------------------------------------------

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1', // IPv6 loopback
  '::', // IPv6 unspecified
  '0000:0000:0000:0000:0000:0000:0000:0001', // IPv6 loopback (full)
  '0000:0000:0000:0000:0000:0000:0000:0000', // IPv6 unspecified (full)
  '169.254.169.254', // AWS/GCP metadata
  'metadata.google.internal',
  'metadata.internal', // Azure metadata alias
]);

const BLOCKED_PREFIXES = [
  '10.',
  '172.16.',
  '172.17.',
  '172.18.',
  '172.19.',
  '172.20.',
  '172.21.',
  '172.22.',
  '172.23.',
  '172.24.',
  '172.25.',
  '172.26.',
  '172.27.',
  '172.28.',
  '172.29.',
  '172.30.',
  '172.31.',
  '192.168.',
  '169.254.',
  'fd', // IPv6 ULA (fd00::/8)
  'fc', // IPv6 ULA (fc00::/8)
  'fe80:', // IPv6 link-local
  '100.64.', // CGNAT (RFC 6598)
  '100.65.',
  '100.66.',
  '100.67.',
  '100.68.',
  '100.69.',
  '100.7', // 100.70-100.127
];

export function isBlockedUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    // Strip brackets from IPv6 hostnames (e.g. [::1] -> ::1)
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    if (BLOCKED_HOSTS.has(hostname)) return true;
    if (BLOCKED_PREFIXES.some((p) => hostname.startsWith(p))) return true;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
    return false;
  } catch {
    return true; // Invalid URL = blocked
  }
}

// ---------------------------------------------------------------------------
// Page fetcher
// ---------------------------------------------------------------------------

async function fetchPage(url: string): Promise<string | null> {
  try {
    let currentUrl = url;
    let redirects = 0;
    const MAX_REDIRECTS = 5;
    const visited = new Set<string>([currentUrl]);

    while (redirects < MAX_REDIRECTS) {
      const res = await fetch(currentUrl, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'manual',
        headers: {
          'User-Agent': 'CeluneBot/1.0 (knowledge-crawler)',
          Accept: 'text/html',
        },
      });

      // Handle redirects manually to check each destination against SSRF blocklist
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return null;

        let resolved: string;
        try {
          resolved = new URL(location, currentUrl).toString();
        } catch {
          console.error(`[url-crawl] Invalid redirect location: ${location} from ${currentUrl}`);
          return null;
        }

        if (isBlockedUrl(resolved)) return null;
        if (visited.has(resolved)) return null; // Redirect loop detected
        visited.add(resolved);
        currentUrl = resolved;
        redirects++;
        continue;
      }

      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) return null;

      return res.text();
    }
    return null; // Too many redirects
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Link extractor
// ---------------------------------------------------------------------------

function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const links: string[] = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    try {
      const resolved = new URL(href, baseUrl);
      // Same domain only
      if (resolved.hostname !== base.hostname) return;
      // Skip anchors, mailto, tel
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
      // Remove hash
      resolved.hash = '';
      links.push(resolved.toString());
    } catch {
      // Invalid URL
    }
  });

  return links;
}

// ---------------------------------------------------------------------------
// Content extractor
// ---------------------------------------------------------------------------

function extractContent(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, nav, footer, header, aside, iframe, noscript').remove();

  const title = $('title').text().trim() || $('h1').first().text().trim() || 'Untitled';

  // Prefer main/article content
  let contentEl = $('main, article, [role="main"]').first();
  if (!contentEl.length) contentEl = $('body');

  const text = contentEl.html() || '';

  return { title, text };
}

// ---------------------------------------------------------------------------
// Crawler
// ---------------------------------------------------------------------------

export async function crawlUrl(params: CrawlParams): Promise<IngestResult> {
  const { sourceId, workspaceId, baseUrl } = params;

  // SSRF: verify the initial URL is not blocked
  if (isBlockedUrl(baseUrl)) {
    return {
      processed: 0,
      added: 0,
      updated: 0,
      unchanged: 0,
      errors: ['Base URL is blocked (internal/private network)'],
    };
  }

  console.log(`[url-crawl] Starting crawl from ${baseUrl}...`);

  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: baseUrl, depth: 0 }];
  const documents: IngestDocument[] = [];

  while (queue.length > 0 && documents.length < MAX_PAGES) {
    const item = queue.shift()!;
    const normalizedUrl = item.url.replace(/\/$/, '');

    if (visited.has(normalizedUrl)) continue;
    visited.add(normalizedUrl);

    // Check robots.txt
    const path = new URL(item.url).pathname;
    const allowed = await isAllowed(baseUrl, path);
    if (!allowed) {
      console.log(`[url-crawl] Blocked by robots.txt: ${path}`);
      continue;
    }

    const html = await fetchPage(item.url);
    if (!html) continue;

    const { title, text } = extractContent(html);
    if (text.trim()) {
      documents.push({
        externalId: normalizedUrl,
        title,
        content: text,
        format: 'html' as ContentFormat,
        metadata: { url: item.url, depth: item.depth },
      });
    }

    // Follow links if under max depth
    if (item.depth < MAX_DEPTH) {
      const links = extractLinks(html, item.url);
      for (const link of links) {
        const normalized = link.replace(/\/$/, '');
        if (!visited.has(normalized)) {
          queue.push({ url: link, depth: item.depth + 1 });
        }
      }
    }
  }

  console.log(`[url-crawl] Crawled ${documents.length} pages (visited ${visited.size} URLs)`);
  return ingestContent({ sourceId, workspaceId, documents });
}
