import { getNangoToken } from '../nango-client';
import { ingestContent, type IngestResult, type IngestDocument } from '../ingest';
import type { ContentFormat } from '../normalize';

interface SyncParams {
  sourceId: string;
  workspaceId: string;
  connectionId: string;
  /** Atlassian cloud site URL, e.g. https://mysite.atlassian.net */
  siteUrl?: string;
}

// ---------------------------------------------------------------------------
// Rate-limit helper
// ---------------------------------------------------------------------------

async function confluenceFetch(url: string, token: string, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') || '1');
      const delay = retryAfter * 1000 * Math.pow(2, attempt);
      console.log(`[confluence] Rate limited, waiting ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return res;
  }
  throw new Error('[confluence] Rate limit retries exhausted');
}

// ---------------------------------------------------------------------------
// Confluence API helpers (v2)
// ---------------------------------------------------------------------------

interface ConfluenceSpace {
  id: string;
  key: string;
  name: string;
}

interface ConfluencePage {
  id: string;
  title: string;
  status: string;
  _links: { webui?: string };
}

interface PageBody {
  atlas_doc_format?: { value: string };
  storage?: { value: string };
}

function getBaseUrl(siteUrl?: string): string {
  return siteUrl || 'https://api.atlassian.com/ex/confluence';
}

async function listSpaces(token: string, baseUrl: string): Promise<ConfluenceSpace[]> {
  const spaces: ConfluenceSpace[] = [];
  let cursor: string | undefined;

  do {
    const url = `${baseUrl}/wiki/api/v2/spaces?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
    const res = await confluenceFetch(url, token);
    if (!res.ok) break;

    const data = (await res.json()) as {
      results: ConfluenceSpace[];
      _links?: { next?: string };
    };
    spaces.push(...data.results);
    // Extract cursor from next link
    cursor = data._links?.next
      ? new URL(data._links.next, baseUrl).searchParams.get('cursor') || undefined
      : undefined;
  } while (cursor);

  return spaces;
}

async function listPages(
  token: string,
  baseUrl: string,
  spaceId: string,
): Promise<ConfluencePage[]> {
  const pages: ConfluencePage[] = [];
  let cursor: string | undefined;

  do {
    const url = `${baseUrl}/wiki/api/v2/spaces/${spaceId}/pages?limit=100&status=current${
      cursor ? `&cursor=${cursor}` : ''
    }`;
    const res = await confluenceFetch(url, token);
    if (!res.ok) break;

    const data = (await res.json()) as {
      results: ConfluencePage[];
      _links?: { next?: string };
    };
    pages.push(...data.results);
    cursor = data._links?.next
      ? new URL(data._links.next, baseUrl).searchParams.get('cursor') || undefined
      : undefined;
  } while (cursor);

  return pages;
}

async function getPageBody(token: string, baseUrl: string, pageId: string): Promise<string | null> {
  const url = `${baseUrl}/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format`;
  const res = await confluenceFetch(url, token);
  if (!res.ok) return null;

  const data = (await res.json()) as { body?: PageBody };

  // Prefer ADF format (maps to our confluence_adf normalizer)
  if (data.body?.atlas_doc_format?.value) {
    return data.body.atlas_doc_format.value;
  }
  // Fallback: storage format (HTML-like)
  if (data.body?.storage?.value) {
    return data.body.storage.value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export async function syncConfluence(params: SyncParams): Promise<IngestResult> {
  const { sourceId, workspaceId, connectionId, siteUrl } = params;
  const token = await getNangoToken(connectionId, 'confluence');
  const baseUrl = getBaseUrl(siteUrl);

  console.log('[confluence] Fetching spaces...');
  const spaces = await listSpaces(token, baseUrl);
  console.log(`[confluence] Found ${spaces.length} spaces`);

  const documents: IngestDocument[] = [];

  for (const space of spaces) {
    const pages = await listPages(token, baseUrl, space.id);
    console.log(`[confluence] Space "${space.name}": ${pages.length} pages`);

    for (const page of pages) {
      try {
        const body = await getPageBody(token, baseUrl, page.id);
        if (!body?.trim()) continue;

        // Detect format: ADF is JSON, storage format is HTML
        let format: ContentFormat = 'html';
        try {
          JSON.parse(body);
          format = 'confluence_adf';
        } catch {
          // not JSON — treat as HTML (storage format)
        }

        documents.push({
          externalId: page.id,
          title: `${space.name} — ${page.title}`,
          content: body,
          format,
          metadata: {
            spaceKey: space.key,
            spaceName: space.name,
            url: page._links.webui || '',
          },
        });
      } catch (err) {
        console.error(`[confluence] Failed to fetch page ${page.id}:`, err);
      }
    }
  }

  console.log(`[confluence] Ingesting ${documents.length} documents...`);
  return ingestContent({ sourceId, workspaceId, documents });
}
