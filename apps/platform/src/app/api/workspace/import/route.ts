/**
 * POST /api/workspace/import?workspace_id=<uuid>[&mode=merge|overwrite]
 *
 * Accepts a celune-workspace export as JSON, gzip, or the zip archive, checks
 * the format version, and merges it into the workspace with ids remapped.
 * Overwrite deletes only rows scoped to this workspace before importing.
 * Auth: API key (write scope) or session plus settings:manage.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { validateOrigin } from '@/lib/csrf';
import { importQuerySchema, resolveWorkspaceOrg } from '@/lib/brain-transfer';
import { authorizeWorkspaceTransfer } from '@/lib/workspace-transfer/auth';
import { parseWorkspaceUpload, readCapped } from '@/lib/workspace-transfer/archive';
import {
  MAX_WORKSPACE_UPLOAD_BYTES,
  WorkspaceTransferError,
} from '@/lib/workspace-transfer/format';
import { importWorkspace } from '@/lib/workspace-transfer/import';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rl = await applyRateLimit(request, 'workspace.import', RATE_WRITE);
  if (rl) return rl.blocked;

  try {
    const actor = await authorizeWorkspaceTransfer(request, 'write');
    if (actor instanceof NextResponse) return actor;
    // API key callers (CLI, Cloud migration) send no Origin header; browser sessions do.
    if (actor.via === 'session') {
      const originError = await validateOrigin(request);
      if (originError) return originError;
    }

    const query = importQuerySchema.safeParse({
      mode: request.nextUrl.searchParams.get('mode') || undefined,
    });
    if (!query.success) {
      return new WorkspaceTransferError(
        'invalid_mode',
        'mode must be one of: merge, overwrite',
      ).toResponse();
    }

    if (Number(request.headers.get('content-length') ?? 0) > MAX_WORKSPACE_UPLOAD_BYTES) {
      return new WorkspaceTransferError(
        'file_too_large',
        `Import exceeds ${MAX_WORKSPACE_UPLOAD_BYTES / (1024 * 1024)} MB`,
        413,
      ).toResponse();
    }
    const upload = parseWorkspaceUpload(await readCapped(request.body));

    // Service client: writes rows for the authorized workspace only. Accesses: workspaces, project_groups, projects, tasks, task_comments, task_attachments, agent_configs, brain tables, task-attachments storage.
    const db = createServiceClient();
    const orgId = await resolveWorkspaceOrg(db, actor.workspaceId);
    const result = await importWorkspace(
      db,
      { workspaceId: actor.workspaceId, orgId, userId: actor.userId },
      upload.file,
      query.data.mode,
      upload.attachments,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WorkspaceTransferError) return error.toResponse();
    return safeErrorResponse(error);
  }
}
