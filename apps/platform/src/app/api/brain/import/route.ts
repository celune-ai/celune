/**
 * POST /api/brain/import?workspace_id=<uuid>[&mode=merge|overwrite]
 *
 * Accepts a brain export document (JSON, or gzip with
 * Content-Type: application/gzip / Content-Encoding: gzip), checks the
 * format version, and merges or overwrites the workspace's brain data.
 * Auth: API key (write scope) or session plus workspace membership, then
 * memory:write (and memory:delete for overwrite) in that workspace.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { validateOrigin } from '@/lib/csrf';
import { authorizeBrainTransfer } from '@/lib/brain-transfer-auth';
import {
  BrainTransferError,
  MAX_DECOMPRESSED_BYTES,
  MAX_IMPORT_BYTES,
  importBrain,
  importQuerySchema,
  parseExportFile,
  resolveWorkspaceOrg,
} from '@/lib/brain-transfer';

export const dynamic = 'force-dynamic';

function tooLarge(limit: number): BrainTransferError {
  return new BrainTransferError(
    'file_too_large',
    `Import file exceeds ${limit / (1024 * 1024)} MB`,
    413,
  );
}

// Counts bytes as they stream so a missing Content-Length or a gzip bomb
// cannot make the handler buffer an unbounded body.
function capStream(stream: ReadableStream<Uint8Array>, limit: number): ReadableStream<Uint8Array> {
  let total = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > limit) controller.error(tooLarge(limit));
        else controller.enqueue(chunk);
      },
    }),
  );
}

async function readBody(request: NextRequest): Promise<unknown> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_IMPORT_BYTES) throw tooLarge(MAX_IMPORT_BYTES);
  if (!request.body) {
    throw new BrainTransferError('invalid_brain_export', 'Body is not valid JSON');
  }
  const type = request.headers.get('content-type') ?? '';
  const gzip =
    type.includes('application/gzip') ||
    type.includes('application/x-gzip') ||
    request.headers.get('content-encoding') === 'gzip';
  let stream = capStream(request.body, MAX_IMPORT_BYTES);
  if (gzip) {
    // DOM lib types the writable side as BufferSource; it accepts Uint8Array chunks.
    const gunzip = new DecompressionStream('gzip') as unknown as TransformStream<
      Uint8Array,
      Uint8Array
    >;
    stream = capStream(stream.pipeThrough(gunzip), MAX_DECOMPRESSED_BYTES);
  }
  let text: string;
  try {
    text = await new Response(stream).text();
  } catch (error) {
    if (error instanceof BrainTransferError) throw error;
    throw new BrainTransferError('invalid_brain_export', 'Body is not valid JSON');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new BrainTransferError('invalid_brain_export', 'Body is not valid JSON');
  }
}

export async function POST(request: NextRequest) {
  const rl = await applyRateLimit(request, 'brain.import', RATE_WRITE);
  if (rl) return rl.blocked;

  try {
    const query = importQuerySchema.safeParse({
      mode: request.nextUrl.searchParams.get('mode') || undefined,
    });
    if (!query.success) {
      return new BrainTransferError(
        'invalid_mode',
        'mode must be one of: merge, overwrite',
      ).toResponse();
    }
    const { mode } = query.data;

    // Overwrite deletes every memory row in the workspace first.
    const actor = await authorizeBrainTransfer(
      request,
      'write',
      mode === 'overwrite' ? ['memory:write', 'memory:delete'] : ['memory:write'],
    );
    if (actor instanceof NextResponse) return actor;
    // API key callers (CLI) send no Origin header; browser sessions do.
    if (actor.via === 'session') {
      const originError = await validateOrigin(request);
      if (originError) return originError;
    }
    const file = parseExportFile(await readBody(request));

    // Service client: writes brain rows for the authorized workspace only. Accesses: workspaces, agent_memory, memory_relations, brain_manifest, brain_section_hashes.
    const db = createServiceClient();
    const orgId = await resolveWorkspaceOrg(db, actor.workspaceId);
    const result = await importBrain(
      db,
      { workspaceId: actor.workspaceId, orgId, userId: actor.userId },
      file,
      mode,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BrainTransferError) return error.toResponse();
    return safeErrorResponse(error);
  }
}
