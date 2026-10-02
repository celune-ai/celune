import type { TaskAttachment } from '@repo/types';
import type { ActorContext } from '../actor.ts';
import { NotFound, Unavailable, ValidationError } from '../errors.ts';
import type { WorkspaceScope } from '../scope.ts';
import type { Store } from '../store.ts';

/** File bytes live outside the database; the host picks the backend. */
export interface AttachmentBlobs {
  put(scope: WorkspaceScope, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(scope: WorkspaceScope, path: string): Promise<void>;
  /** A time-limited download URL, or null when the backend cannot sign one. */
  signedUrl(scope: WorkspaceScope, path: string, expiresInSeconds: number): Promise<string | null>;
}

/** The parts of a web `File` the service reads, so tests and servers can pass plain objects. */
export interface AttachmentFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type AttachmentView = Omit<TaskAttachment, 'download_url'> & {
  download_url: string | null;
};

export interface AttachmentUploadResult {
  attachments: AttachmentView[];
  errors: { file: string; error: string }[];
}

export interface AttachmentServiceOptions {
  blobs?: AttachmentBlobs;
  randomId?: () => string;
}

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const SIGNED_URL_SECONDS = 3600;

export const ATTACHMENT_MIME_TYPES: ReadonlySet<string> = new Set([
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

/** Browsers often send a generic type for source files; the extension decides then. */
const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.py': 'text/x-python',
  '.sql': 'application/sql',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'application/toml',
};

export function resolveAttachmentMime(name: string, type: string): string {
  if (type && ATTACHMENT_MIME_TYPES.has(type)) return type;
  const ext = '.' + (name.split('.').pop() ?? '').toLowerCase();
  return EXT_TO_MIME[ext] ?? type;
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

function defaultRandomId(): string {
  return globalThis.crypto.randomUUID();
}

/** Task attachments: rows in the Store, bytes in AttachmentBlobs, always scoped to a task in the workspace. */
export class AttachmentService {
  private readonly store: Store;
  private readonly blobs: AttachmentBlobs | undefined;
  private readonly randomId: () => string;

  constructor(store: Store, options: AttachmentServiceOptions = {}) {
    this.store = store;
    this.blobs = options.blobs;
    this.randomId = options.randomId ?? defaultRandomId;
  }

  /** False when no blob backend is configured; uploads then answer 501. */
  get canStore(): boolean {
    return this.blobs !== undefined;
  }

  /** Newest first, each with a one-hour download URL when the backend can sign one. */
  async list(scope: WorkspaceScope, taskId: string): Promise<AttachmentView[]> {
    await this.store.tasks.get(scope, taskId);
    const rows = await this.store.attachments.list(scope, taskId);
    const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return Promise.all(sorted.map((row) => this.view(scope, row)));
  }

  /** Stores each valid file; invalid ones land in `errors` and do not stop the rest. */
  async upload(
    scope: WorkspaceScope,
    taskId: string,
    files: AttachmentFile[],
    uploadedBy: string,
    actor: ActorContext,
  ): Promise<AttachmentUploadResult> {
    const blobs = this.blobs;
    if (!blobs) throw new Unavailable('Attachment storage is not configured');
    const task = await this.store.tasks.get(scope, taskId);
    if (files.length === 0) throw new ValidationError('No files provided');

    const attachments: AttachmentView[] = [];
    const errors: AttachmentUploadResult['errors'] = [];
    for (const file of files) {
      if (file.size > ATTACHMENT_MAX_BYTES) {
        const mb = (file.size / 1024 / 1024).toFixed(1);
        errors.push({ file: file.name, error: `File exceeds 10MB limit (${mb}MB)` });
        continue;
      }
      const mimeType = resolveAttachmentMime(file.name, file.type);
      if (!ATTACHMENT_MIME_TYPES.has(mimeType)) {
        errors.push({ file: file.name, error: `File type not allowed: ${mimeType}` });
        continue;
      }
      const path = `${taskId}/${this.randomId()}_${sanitizeFileName(file.name)}`;
      try {
        await blobs.put(scope, path, new Uint8Array(await file.arrayBuffer()), mimeType);
      } catch {
        errors.push({ file: file.name, error: 'Upload failed' });
        continue;
      }
      let row: TaskAttachment;
      try {
        row = await this.store.attachments.add(scope, {
          task_id: taskId,
          file_name: file.name,
          file_size: file.size,
          mime_type: mimeType,
          storage_path: path,
          uploaded_by: uploadedBy,
          user_id: task.user_id ?? actor.ownerUserId ?? actor.userId ?? null,
        });
      } catch {
        await blobs.remove(scope, path).catch(() => undefined);
        errors.push({ file: file.name, error: 'Could not record the attachment' });
        continue;
      }
      attachments.push(await this.view(scope, row));
    }

    if (attachments.length > 0) {
      await this.store.activity.append(scope, {
        event_type: 'attachment.uploaded',
        severity: 'info',
        source: actor.source,
        title: `${attachments.length} file(s) uploaded: ${attachments.map((a) => a.file_name).join(', ')}`,
        task_id: taskId,
        actor_user_id: actor.userId ?? null,
        user_id: actor.ownerUserId ?? null,
        details: {
          file_count: attachments.length,
          error_count: errors.length,
          files: attachments.map((a) => ({
            name: a.file_name,
            size: a.file_size,
            type: a.mime_type,
          })),
        },
      });
    }
    return { attachments, errors };
  }

  async remove(
    scope: WorkspaceScope,
    taskId: string,
    attachmentId: string,
    actor: ActorContext,
  ): Promise<void> {
    await this.store.tasks.get(scope, taskId);
    const rows = await this.store.attachments.list(scope, taskId);
    const row = rows.find((a) => a.id === attachmentId);
    if (!row) throw new NotFound('Attachment', attachmentId);
    // The row goes even when the blob delete fails, so the UI never shows a dead file.
    await this.blobs?.remove(scope, row.storage_path).catch(() => undefined);
    await this.store.attachments.remove(scope, taskId, attachmentId);
    await this.store.activity.append(scope, {
      event_type: 'attachment.deleted',
      severity: 'info',
      source: actor.source,
      title: `Attachment deleted: ${row.file_name}`,
      task_id: taskId,
      actor_user_id: actor.userId ?? null,
      user_id: actor.ownerUserId ?? null,
      details: { attachment_id: attachmentId, file_name: row.file_name },
    });
  }

  private async view(scope: WorkspaceScope, row: TaskAttachment): Promise<AttachmentView> {
    const url = this.blobs
      ? await this.blobs.signedUrl(scope, row.storage_path, SIGNED_URL_SECONDS).catch(() => null)
      : null;
    return { ...row, download_url: url };
  }
}
