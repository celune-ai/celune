import type { AttachmentBlobs } from '../attachments/attachment-service.ts';
import type { WorkspaceScope } from '../scope.ts';

/** Attachment bytes in a Map, keyed by workspace and path. */
export class InMemoryBlobs implements AttachmentBlobs {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  private key(scope: WorkspaceScope, path: string): string {
    return `${scope.workspaceId}:${path}`;
  }

  async put(scope: WorkspaceScope, path: string, bytes: Uint8Array, contentType: string) {
    this.objects.set(this.key(scope, path), { bytes, contentType });
  }

  async remove(scope: WorkspaceScope, path: string) {
    this.objects.delete(this.key(scope, path));
  }

  async signedUrl(scope: WorkspaceScope, path: string) {
    return this.objects.has(this.key(scope, path)) ? `memory://${path}` : null;
  }
}
