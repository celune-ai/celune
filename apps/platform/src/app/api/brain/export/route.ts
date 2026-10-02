/**
 * GET /api/brain/export?workspace_id=<uuid>[&compress=true|false]
 *
 * Streams the calling workspace's brain data as a versioned JSON document.
 * Large exports are gzipped unless compress=false is passed.
 * Auth: API key (read scope) or session plus workspace membership, then
 * memory:read in that workspace.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';
import { authorizeBrainTransfer } from '@/lib/brain-transfer-auth';
import {
  BRAIN_FORMAT_VERSION,
  COMPRESS_ROW_THRESHOLD,
  chunksToStream,
  exportChunks,
  getExportCounts,
} from '@/lib/brain-transfer';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const rl = await applyRateLimit(request, 'brain.export', RATE_READ);
  if (rl) return rl.blocked;

  try {
    const actor = await authorizeBrainTransfer(request, 'read', ['memory:read']);
    if (actor instanceof NextResponse) return actor;

    // Service client: reads a single workspace's brain rows after auth above. Accesses: agent_memory, memory_relations, brain_manifest, brain_section_hashes.
    const db = createServiceClient();
    const counts = await getExportCounts(db, actor.workspaceId);
    const total = counts.agent_memory + counts.memory_relations + counts.brain_manifest;

    const compressParam = request.nextUrl.searchParams.get('compress');
    const compress =
      compressParam === 'true' || (compressParam !== 'false' && total > COMPRESS_ROW_THRESHOLD);

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `celune-brain-${actor.workspaceId.slice(0, 8)}-${stamp}.json${compress ? '.gz' : ''}`;

    let body = chunksToStream(exportChunks(db, actor.workspaceId, counts));
    if (compress) {
      // Node and DOM lib typings for CompressionStream disagree on the chunk type.
      const gzip = new CompressionStream('gzip') as unknown as TransformStream<
        Uint8Array,
        Uint8Array
      >;
      body = body.pipeThrough(gzip);
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': compress ? 'application/gzip' : 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'X-Brain-Format-Version': String(BRAIN_FORMAT_VERSION),
      },
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
