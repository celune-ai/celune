import { ingestContent, type IngestResult } from '../ingest';
import type { ContentFormat } from '../normalize';

interface UploadParams {
  sourceId: string;
  workspaceId: string;
  filename: string;
  buffer: Buffer;
  mimeType: string;
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

function detectFormat(filename: string, mimeType: string): ContentFormat {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();

  if (ext === '.md' || mimeType === 'text/markdown') return 'markdown';
  if (ext === '.html' || ext === '.htm' || mimeType === 'text/html') return 'html';
  if (ext === '.txt' || mimeType === 'text/plain') return 'text';

  // Default to text for unknown types
  return 'text';
}

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

async function extractContent(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();

  // PDF extraction
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    return extractPdf(buffer);
  }

  // DOCX extraction
  if (
    ext === '.docx' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return extractDocx(buffer);
  }

  // Plain text / markdown / HTML — direct decode
  return buffer.toString('utf-8');
}

async function extractPdf(buffer: Buffer): Promise<string> {
  try {
    // Try pdf-parse if available
    const pdfParse = await import('pdf-parse').then((m) => m.default || m).catch(() => null);
    if (pdfParse) {
      const result = await pdfParse(buffer);
      return result.text;
    }
  } catch {
    // pdf-parse not available
  }

  // Fallback: basic text extraction from PDF binary
  // Extracts text between stream/endstream markers (very basic)
  const text = buffer.toString('latin1');
  const matches = text.match(/\(([^)]+)\)/g);
  if (matches) {
    return matches.map((m) => m.slice(1, -1)).join(' ');
  }
  return '[PDF content — install pdf-parse for full extraction]';
}

async function extractDocx(buffer: Buffer): Promise<string> {
  try {
    // Try mammoth if available
    const mammoth = await import('mammoth').then((m) => m.default || m).catch(() => null);
    if (mammoth && mammoth.extractRawText) {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
  } catch {
    // mammoth not available
  }

  // Fallback: basic XML extraction from DOCX (ZIP with XML inside)
  // DOCX files are ZIP archives — look for readable text
  const text = buffer.toString('utf-8');
  // Strip XML tags to get raw text
  const stripped = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length > 50) return stripped;

  return '[DOCX content — install mammoth for full extraction]';
}

// ---------------------------------------------------------------------------
// Upload handler
// ---------------------------------------------------------------------------

export async function processUpload(params: UploadParams): Promise<IngestResult> {
  const { sourceId, workspaceId, filename, buffer, mimeType } = params;

  console.log(`[upload] Processing ${filename} (${mimeType}, ${buffer.length} bytes)...`);

  const content = await extractContent(buffer, filename, mimeType);
  if (!content.trim()) {
    return { processed: 1, added: 0, updated: 0, unchanged: 0, errors: ['Empty content'] };
  }

  const format = detectFormat(filename, mimeType);

  return ingestContent({
    sourceId,
    workspaceId,
    documents: [
      {
        externalId: `upload:${filename}`,
        title: filename,
        content,
        format,
        metadata: { mimeType, size: buffer.length },
      },
    ],
  });
}
