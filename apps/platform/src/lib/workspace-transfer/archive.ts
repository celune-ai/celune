import { Gunzip, strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { sanitizeAttachmentName } from '@/lib/attachment-types';
import type { Db, WorkspaceExport } from './export';
import { DOCKER_ENV_EXAMPLE } from './env-example.generated';
import {
  ATTACHMENTS_BUCKET,
  MAX_WORKSPACE_EXPANDED_BYTES,
  MAX_WORKSPACE_UPLOAD_BYTES,
  MAX_ZIP_ENTRIES,
  WorkspaceTransferError,
  ZIP_ATTACHMENT_DIR,
  ZIP_EXPORT_ENTRY,
  parseWorkspaceFile,
  type WorkspaceExportFile,
} from './format';

/** Attachment bytes are bundled up to this total so the zip stays under the import cap. */
export const MAX_BUNDLED_ATTACHMENT_BYTES = 40 * 1024 * 1024;

const ATTACHMENT_ENTRY = /^attachments\/([0-9a-f-]{36})\/[^/]+$/i;

export interface ReadmeContext {
  productName: string;
  docsUrl: string;
  attachmentsOmitted: number;
}

export function buildReadme(file: WorkspaceExportFile, ctx: ReadmeContext): string {
  const counts = Object.entries(file.counts ?? {})
    .map(([table, n]) => `- ${table}: ${n}`)
    .join('\n');
  const omitted =
    ctx.attachmentsOmitted > 0
      ? `\n${ctx.attachmentsOmitted} attachment file(s) were left out to keep the archive under the import size limit. Their metadata is in workspace.json; download them from the source workspace if you need them.\n`
      : '';
  return `# ${ctx.productName} workspace export

Workspace: ${file.settings.name ?? 'unnamed'}
Exported: ${file.exported_at ?? 'unknown'}
Format: ${file.format} v${file.format_version}

## Contents

- \`${ZIP_EXPORT_ENTRY}\`: projects, tasks, comments, dependencies, attachment metadata, agent configs, workspace settings, and the brain (memories, relations, manifest).
- \`${ZIP_ATTACHMENT_DIR}\`: attachment files, one folder per attachment id.
- \`.env.example\`: the environment template for the self-hosted Docker stack.

${counts}
${omitted}
## What is not included

Provider keys, API keys, integration tokens, webhook URLs, and any encrypted column stay on the source instance. Add your own keys in Settings after the import.

## Load it into a self-hosted instance

1. Start the stack: run \`npx @celuneai/cli init --mode docker\` from a checkout of the repository, then \`docker compose -f docker/docker-compose.yml up -d --build\`. The init command writes \`docker/.env\` from \`.env.example\` and generates every secret.
2. Sign in, create a workspace, and create an API key with write scope in Settings.
3. Import this archive with the CLI, pointed at your instance and using that key:

\`\`\`
export CELUNE_API_URL=http://localhost:3000
export CELUNE_API_KEY=<the key from step 2>
npx @celuneai/cli workspace import <this-file>.zip
\`\`\`

The import merges into the workspace. Running it again skips rows that already arrived. The source workspace is not changed by the export or the import.

Docs: ${ctx.docsUrl}
`;
}

async function downloadBytes(db: Db, path: string): Promise<Uint8Array | null> {
  const { data, error } = await db.storage.from(ATTACHMENTS_BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/** Zip with the export document, a README, the Docker env template, and attachment bytes. */
export async function buildWorkspaceZip(
  db: Db,
  exported: WorkspaceExport,
  ctx: Omit<ReadmeContext, 'attachmentsOmitted'>,
  includeAttachments = true,
): Promise<Uint8Array> {
  const entries: Zippable = {};
  let budget = MAX_BUNDLED_ATTACHMENT_BYTES;
  let omitted = 0;
  if (includeAttachments) {
    for (const att of exported.file.task_attachments) {
      const path = exported.storagePaths.get(att.id);
      if (!path || att.file_size > budget) {
        omitted++;
        continue;
      }
      const bytes = await downloadBytes(db, path);
      if (!bytes || bytes.byteLength > budget) {
        omitted++;
        continue;
      }
      budget -= bytes.byteLength;
      entries[`${ZIP_ATTACHMENT_DIR}${att.id}/${sanitizeAttachmentName(att.file_name)}`] = bytes;
    }
  } else {
    omitted = exported.file.task_attachments.length;
  }
  entries[ZIP_EXPORT_ENTRY] = strToU8(JSON.stringify(exported.file));
  entries['README.md'] = strToU8(
    buildReadme(exported.file, { ...ctx, attachmentsOmitted: omitted }),
  );
  entries['.env.example'] = strToU8(DOCKER_ENV_EXAMPLE);
  return zipSync(entries, { level: 6 });
}

/** Reads a request body up to the upload cap without trusting Content-Length. */
export async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  limit = MAX_WORKSPACE_UPLOAD_BYTES,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw tooLarge(limit);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function tooLarge(limit: number): WorkspaceTransferError {
  return new WorkspaceTransferError(
    'file_too_large',
    `Import exceeds ${limit / (1024 * 1024)} MB`,
    413,
  );
}

function gunzipCapped(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  const stream = new Gunzip((chunk) => {
    total += chunk.byteLength;
    if (total > MAX_WORKSPACE_EXPANDED_BYTES) throw tooLarge(MAX_WORKSPACE_EXPANDED_BYTES);
    parts.push(chunk);
  });
  try {
    stream.push(data, true);
  } catch (error) {
    if (error instanceof WorkspaceTransferError) throw error;
    throw new WorkspaceTransferError('invalid_workspace_export', 'Body is not valid gzip');
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    throw new WorkspaceTransferError(
      'invalid_workspace_export',
      'Export document is not valid JSON',
    );
  }
}

export interface WorkspaceUpload {
  file: WorkspaceExportFile;
  attachments: Map<string, Uint8Array>;
}

/**
 * Accepts the export as JSON, gzip, or the zip archive. Zip entries are
 * limited by count and declared size before anything is inflated, and only
 * workspace.json and attachments/<id>/<name> entries are read.
 */
export function parseWorkspaceUpload(bytes: Uint8Array): WorkspaceUpload {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isZip) {
    const doc = parseJson(isGzip ? gunzipCapped(bytes) : bytes);
    return { file: parseWorkspaceFile(doc), attachments: new Map() };
  }

  let entries = 0;
  let expanded = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (entry) => {
        const wanted = entry.name === ZIP_EXPORT_ENTRY || ATTACHMENT_ENTRY.test(entry.name);
        if (!wanted) return false;
        entries++;
        expanded += entry.originalSize;
        if (entries > MAX_ZIP_ENTRIES) {
          throw new WorkspaceTransferError(
            'too_many_entries',
            `Archive has more than ${MAX_ZIP_ENTRIES} entries`,
            413,
          );
        }
        if (expanded > MAX_WORKSPACE_EXPANDED_BYTES) throw tooLarge(MAX_WORKSPACE_EXPANDED_BYTES);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof WorkspaceTransferError) throw error;
    throw new WorkspaceTransferError('invalid_workspace_export', 'Body is not a valid zip archive');
  }

  const doc = files[ZIP_EXPORT_ENTRY];
  if (!doc) {
    throw new WorkspaceTransferError(
      'invalid_workspace_export',
      `Archive has no ${ZIP_EXPORT_ENTRY}`,
    );
  }
  const attachments = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(files)) {
    const match = ATTACHMENT_ENTRY.exec(name);
    if (match) attachments.set(match[1]!.toLowerCase(), data);
  }
  return { file: parseWorkspaceFile(parseJson(doc)), attachments };
}
