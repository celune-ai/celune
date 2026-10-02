/** Attachment rules shared by the upload route and the workspace importer. */
export const ALLOWED_ATTACHMENT_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'text/markdown',
  'text/plain',
  'application/json',
  'text/csv',
  'text/tab-separated-values',
  'text/typescript',
  'text/javascript',
  'text/x-python',
  'application/sql',
  'text/yaml',
  'application/x-yaml',
  'application/toml',
]);

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function sanitizeAttachmentName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}
