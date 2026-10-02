import { getNangoToken } from '../nango-client';
import { ingestContent, type IngestResult, type IngestDocument } from '../ingest';
import type { ContentFormat } from '../normalize';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

interface SyncParams {
  sourceId: string;
  workspaceId: string;
  connectionId: string;
}

// ---------------------------------------------------------------------------
// Rate-limit helper
// ---------------------------------------------------------------------------

async function driveFetch(url: string, token: string, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) {
      const delay = 1000 * Math.pow(2, attempt);
      console.log(`[google-drive] Rate limited, waiting ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return res;
  }
  throw new Error('[google-drive] Rate limit retries exhausted');
}

// ---------------------------------------------------------------------------
// Drive API helpers
// ---------------------------------------------------------------------------

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
}

const SUPPORTED_MIME_TYPES = [
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'text/plain',
  'text/markdown',
  'application/pdf',
].join("','");

async function listFiles(token: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const query = encodeURIComponent(`mimeType in ('${SUPPORTED_MIME_TYPES}') and trashed = false`);
    const url = `${DRIVE_API}/files?q=${query}&fields=files(id,name,mimeType,webViewLink),nextPageToken&pageSize=100${
      pageToken ? `&pageToken=${pageToken}` : ''
    }`;

    const res = await driveFetch(url, token);
    if (!res.ok) break;

    const data = (await res.json()) as {
      files: DriveFile[];
      nextPageToken?: string;
    };
    files.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return files;
}

async function exportAsText(
  token: string,
  fileId: string,
  mimeType: string,
): Promise<string | null> {
  const exportMime = 'text/plain';
  let url: string;

  if (mimeType.startsWith('application/vnd.google-apps.')) {
    // Google Docs/Sheets — use export endpoint
    url = `${DRIVE_API}/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`;
  } else {
    // Regular files — download directly
    url = `${DRIVE_API}/files/${fileId}?alt=media`;
  }

  const res = await driveFetch(url, token);
  if (!res.ok) return null;
  return res.text();
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export async function syncGoogleDrive(params: SyncParams): Promise<IngestResult> {
  const { sourceId, workspaceId, connectionId } = params;
  const token = await getNangoToken(connectionId, 'google-drive');

  console.log('[google-drive] Listing files...');
  const files = await listFiles(token);
  console.log(`[google-drive] Found ${files.length} files`);

  const documents: IngestDocument[] = [];

  for (const file of files) {
    try {
      const content = await exportAsText(token, file.id, file.mimeType);
      if (!content?.trim()) continue;

      const format: ContentFormat = file.mimeType === 'text/markdown' ? 'markdown' : 'text';

      documents.push({
        externalId: file.id,
        title: file.name,
        content,
        format,
        metadata: { mimeType: file.mimeType, url: file.webViewLink || '' },
      });
    } catch (err) {
      console.error(`[google-drive] Failed to export ${file.name}:`, err);
    }
  }

  console.log(`[google-drive] Ingesting ${documents.length} documents...`);
  return ingestContent({ sourceId, workspaceId, documents });
}
