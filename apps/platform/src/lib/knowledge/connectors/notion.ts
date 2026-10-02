import { getNangoToken } from '../nango-client';
import { ingestContent, type IngestResult } from '../ingest';
import type { ContentFormat } from '../normalize';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

interface SyncParams {
  sourceId: string;
  workspaceId: string;
  connectionId: string;
}

// ---------------------------------------------------------------------------
// Rate-limit helper
// ---------------------------------------------------------------------------

async function rateLimitedFetch(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') || '1');
      const delay = retryAfter * 1000 * Math.pow(2, attempt);
      console.log(`[notion] Rate limited, waiting ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return res;
  }
  throw new Error('[notion] Rate limit retries exhausted');
}

// ---------------------------------------------------------------------------
// Notion API helpers
// ---------------------------------------------------------------------------

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

interface NotionPage {
  id: string;
  properties: Record<string, { title?: Array<{ plain_text: string }> }>;
  url: string;
}

async function searchPages(token: string): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let startCursor: string | undefined;

  do {
    const body: Record<string, unknown> = {
      filter: { value: 'page', property: 'object' },
      page_size: 100,
    };
    if (startCursor) body.start_cursor = startCursor;

    const res = await rateLimitedFetch(`${NOTION_API}/search`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Notion search failed: ${res.status}`);

    const data = (await res.json()) as {
      results: NotionPage[];
      has_more: boolean;
      next_cursor?: string;
    };

    pages.push(...data.results);
    startCursor = data.has_more ? data.next_cursor : undefined;
  } while (startCursor);

  return pages;
}

async function getBlocks(token: string, blockId: string, depth = 0): Promise<unknown[]> {
  if (depth > 3) return [];

  const blocks: unknown[] = [];
  let startCursor: string | undefined;

  do {
    const url = `${NOTION_API}/blocks/${blockId}/children?page_size=100${
      startCursor ? `&start_cursor=${startCursor}` : ''
    }`;

    const res = await rateLimitedFetch(url, { headers: headers(token) });
    if (!res.ok) return blocks;

    const data = (await res.json()) as {
      results: Array<{ id: string; has_children: boolean; type: string; [key: string]: unknown }>;
      has_more: boolean;
      next_cursor?: string;
    };

    for (const block of data.results) {
      blocks.push(block);
      if (block.has_children) {
        const children = await getBlocks(token, block.id, depth + 1);
        if (children.length > 0) {
          (block as Record<string, unknown>).children = children;
        }
      }
    }

    startCursor = data.has_more ? data.next_cursor : undefined;
  } while (startCursor);

  return blocks;
}

function getPageTitle(page: NotionPage): string {
  for (const prop of Object.values(page.properties)) {
    if (prop.title && prop.title.length > 0) {
      return prop.title.map((t) => t.plain_text).join('');
    }
  }
  return 'Untitled';
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export async function syncNotion(params: SyncParams): Promise<IngestResult> {
  const { sourceId, workspaceId, connectionId } = params;
  const token = await getNangoToken(connectionId, 'notion');

  console.log('[notion] Fetching pages...');
  const pages = await searchPages(token);
  console.log(`[notion] Found ${pages.length} pages`);

  const documents = [];

  for (const page of pages) {
    try {
      const blocks = await getBlocks(token, page.id);
      documents.push({
        externalId: page.id,
        title: getPageTitle(page),
        content: JSON.stringify(blocks),
        format: 'notion_blocks' as ContentFormat,
        metadata: { url: page.url },
      });
    } catch (err) {
      console.error(`[notion] Failed to fetch blocks for ${page.id}:`, err);
    }
  }

  console.log(`[notion] Ingesting ${documents.length} documents...`);
  return ingestContent({ sourceId, workspaceId, documents });
}
