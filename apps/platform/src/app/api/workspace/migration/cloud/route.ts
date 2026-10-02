/**
 * POST /api/workspace/migration/cloud?workspace_id=<uuid>
 * Body: { "api_key": "<Cloud API key with write scope>" }
 *
 * Community edition only. Exports this workspace and uploads it to the Cloud
 * workspace that owns the pasted key, in merge mode. The key is used for this
 * one request and is never stored or logged. Source rows are never deleted.
 * Auth: session plus settings:manage.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_AUTH } from '@/lib/rate-limiter';
import { validateOrigin } from '@/lib/csrf';
import { hostConfig } from '@/lib/host-config';
import { authorizeWorkspaceTransfer } from '@/lib/workspace-transfer/auth';
import { WorkspaceTransferError } from '@/lib/workspace-transfer/format';
import { pushToCloud } from '@/lib/workspace-transfer/migration';

const bodySchema = z.object({ api_key: z.string().trim().min(1) });

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rl = await applyRateLimit(request, 'workspace.migration.cloud', RATE_AUTH);
  if (rl) return rl.blocked;

  try {
    if (hostConfig.edition !== 'community') {
      return new WorkspaceTransferError(
        'edition_not_supported',
        'Moving to Cloud is only available on a self-hosted instance',
        403,
      ).toResponse();
    }

    const actor = await authorizeWorkspaceTransfer(request, 'write');
    if (actor instanceof NextResponse) return actor;
    if (actor.via !== 'session') {
      return NextResponse.json({ error: 'Sign in to move a workspace' }, { status: 403 });
    }
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return new WorkspaceTransferError(
        'invalid_api_key',
        'Paste a Cloud API key with write scope',
      ).toResponse();
    }

    // Service client: reads this workspace's rows for the upload after auth above. Accesses: workspaces, project_groups, projects, tasks, task_comments, task_attachments, agent_configs, brain tables, task-attachments storage.
    const result = await pushToCloud({
      db: createServiceClient(),
      workspaceId: actor.workspaceId,
      apiKey: parsed.data.api_key,
      cloudUrl: hostConfig.cloudUrl,
      productName: hostConfig.productName,
      docsUrl: hostConfig.docsUrl,
    });
    return NextResponse.json({ ...result, cloud_url: hostConfig.cloudUrl });
  } catch (error) {
    if (error instanceof WorkspaceTransferError) return error.toResponse();
    return safeErrorResponse(error);
  }
}
