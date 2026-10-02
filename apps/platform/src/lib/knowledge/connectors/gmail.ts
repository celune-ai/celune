import { getNangoToken } from '../nango-client';
import { ingestContent, type IngestResult, type IngestDocument } from '../ingest';
import type { ContentFormat } from '../normalize';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_MESSAGES = 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

interface SyncParams {
  sourceId: string;
  workspaceId: string;
  connectionId: string;
}

// ---------------------------------------------------------------------------
// Rate-limit helper
// ---------------------------------------------------------------------------

async function gmailFetch(url: string, token: string, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) {
      const delay = 1000 * Math.pow(2, attempt);
      console.log(`[gmail] Rate limited, waiting ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return res;
  }
  throw new Error('[gmail] Rate limit retries exhausted');
}

// ---------------------------------------------------------------------------
// Gmail API helpers
// ---------------------------------------------------------------------------

interface MessageRef {
  id: string;
  threadId: string;
}

interface MessageHeader {
  name: string;
  value: string;
}

interface MessagePart {
  mimeType: string;
  body: { data?: string; size: number };
  parts?: MessagePart[];
}

interface FullMessage {
  id: string;
  threadId: string;
  internalDate: string;
  payload: {
    headers: MessageHeader[];
    mimeType: string;
    body: { data?: string; size: number };
    parts?: MessagePart[];
  };
  snippet: string;
}

async function listMessages(token: string): Promise<MessageRef[]> {
  const messages: MessageRef[] = [];
  let pageToken: string | undefined;
  const after = Math.floor((Date.now() - NINETY_DAYS_MS) / 1000);
  const query = encodeURIComponent(`after:${after}`);

  do {
    const url = `${GMAIL_API}/messages?q=${query}&maxResults=100${
      pageToken ? `&pageToken=${pageToken}` : ''
    }`;

    const res = await gmailFetch(url, token);
    if (!res.ok) break;

    const data = (await res.json()) as {
      messages?: MessageRef[];
      nextPageToken?: string;
    };
    if (data.messages) messages.push(...data.messages);
    pageToken = data.nextPageToken;
  } while (pageToken && messages.length < MAX_MESSAGES);

  return messages.slice(0, MAX_MESSAGES);
}

async function getMessage(token: string, id: string): Promise<FullMessage | null> {
  const res = await gmailFetch(`${GMAIL_API}/messages/${id}?format=full`, token);
  if (!res.ok) return null;
  return (await res.json()) as FullMessage;
}

function getHeader(msg: FullMessage, name: string): string {
  return msg.payload.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function extractBody(part: MessagePart | FullMessage['payload']): string {
  // Prefer text/plain
  if (part.mimeType === 'text/plain' && part.body.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf-8');
  }

  if (part.parts) {
    for (const sub of part.parts) {
      const text = extractBody(sub);
      if (text) return text;
    }
  }

  // Fallback to text/html, strip tags
  if (part.mimeType === 'text/html' && part.body.data) {
    const html = Buffer.from(part.body.data, 'base64url').toString('utf-8');
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return '';
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export async function syncGmail(params: SyncParams): Promise<IngestResult> {
  const { sourceId, workspaceId, connectionId } = params;
  const token = await getNangoToken(connectionId, 'google-mail');

  console.log('[gmail] Listing messages (last 90 days)...');
  const refs = await listMessages(token);
  console.log(`[gmail] Found ${refs.length} messages`);

  const documents: IngestDocument[] = [];

  for (const ref of refs) {
    try {
      const msg = await getMessage(token, ref.id);
      if (!msg) continue;

      const subject = getHeader(msg, 'Subject') || '(no subject)';
      const from = getHeader(msg, 'From');
      const date = getHeader(msg, 'Date');
      const body = extractBody(msg.payload);

      if (!body.trim()) continue;

      const content = [`From: ${from}`, `Date: ${date}`, `Subject: ${subject}`, '', body].join(
        '\n',
      );

      documents.push({
        externalId: msg.id,
        title: subject,
        content,
        format: 'text' as ContentFormat,
        metadata: { from, date, threadId: msg.threadId },
      });
    } catch (err) {
      console.error(`[gmail] Failed to fetch message ${ref.id}:`, err);
    }
  }

  console.log(`[gmail] Ingesting ${documents.length} documents...`);
  return ingestContent({ sourceId, workspaceId, documents });
}
