import { getNangoToken } from '../nango-client';
import { ingestContent, type IngestResult, type IngestDocument } from '../ingest';
import type { ContentFormat } from '../normalize';

const DROPBOX_API = 'https://api.dropboxapi.com/2';
const DROPBOX_CONTENT = 'https://content.dropboxapi.com/2';

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.csv', '.json', '.xml', '.yml', '.yaml', '.rst']);

interface SyncParams {
  sourceId: string;
  workspaceId: string;
  connectionId: string;
}

// ---------------------------------------------------------------------------
// Rate-limit helper
// ---------------------------------------------------------------------------

async function dbxFetch(
  url: string,
  token: string,
  options: RequestInit = {},
  retries = 3,
): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...((options.headers as Record<string, string>) || {}),
      },
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') || '1');
      const delay = retryAfter * 1000 * Math.pow(2, attempt);
      console.log(`[dropbox] Rate limited, waiting ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return res;
  }
  throw new Error('[dropbox] Rate limit retries exhausted');
}

// ---------------------------------------------------------------------------
// Dropbox API helpers
// ---------------------------------------------------------------------------

interface DropboxEntry {
  '.tag': 'file' | 'folder' | 'deleted';
  name: string;
  path_lower: string;
  id: string;
  size?: number;
}

async function listFolder(token: string, path = ''): Promise<DropboxEntry[]> {
  const entries: DropboxEntry[] = [];

  const res = await dbxFetch(`${DROPBOX_API}/files/list_folder`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: path || '',
      recursive: true,
      limit: 2000,
    }),
  });

  if (!res.ok) return entries;

  let data = (await res.json()) as {
    entries: DropboxEntry[];
    has_more: boolean;
    cursor: string;
  };
  entries.push(...data.entries);

  while (data.has_more) {
    const contRes = await dbxFetch(`${DROPBOX_API}/files/list_folder/continue`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cursor: data.cursor }),
    });
    if (!contRes.ok) break;
    data = (await contRes.json()) as typeof data;
    entries.push(...data.entries);
  }

  return entries;
}

async function downloadFile(token: string, path: string): Promise<string | null> {
  const res = await dbxFetch(`${DROPBOX_CONTENT}/files/download`, token, {
    method: 'POST',
    headers: { 'Dropbox-API-Arg': JSON.stringify({ path }) },
  });
  if (!res.ok) return null;
  return res.text();
}

function isTextFile(name: string): boolean {
  const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

function getFormat(name: string): ContentFormat {
  if (name.endsWith('.md')) return 'markdown';
  return 'text';
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export async function syncDropbox(params: SyncParams): Promise<IngestResult> {
  const { sourceId, workspaceId, connectionId } = params;
  const token = await getNangoToken(connectionId, 'dropbox');

  console.log('[dropbox] Listing files...');
  const entries = await listFolder(token);
  const textFiles = entries.filter(
    (e) => e['.tag'] === 'file' && isTextFile(e.name) && (e.size || 0) < 10_000_000,
  );
  console.log(`[dropbox] Found ${textFiles.length} text files`);

  const documents: IngestDocument[] = [];

  for (const file of textFiles) {
    try {
      const content = await downloadFile(token, file.path_lower);
      if (!content?.trim()) continue;

      documents.push({
        externalId: file.id,
        title: file.name,
        content,
        format: getFormat(file.name),
        metadata: { path: file.path_lower },
      });
    } catch (err) {
      console.error(`[dropbox] Failed to download ${file.path_lower}:`, err);
    }
  }

  console.log(`[dropbox] Ingesting ${documents.length} documents...`);
  return ingestContent({ sourceId, workspaceId, documents });
}
