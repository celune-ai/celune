/**
 * GET /api/workspace/export?workspace_id=<uuid>[&format=json|zip][&attachments=true|false]
 *
 * Exports the workspace as a celune-workspace v1 document. format=zip adds a
 * README, the Docker env template, and attachment bytes. Secrets never leave.
 * Auth: API key (read scope) or session plus settings:manage.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';
import { hostConfig } from '@/lib/host-config';
import { authorizeWorkspaceTransfer } from '@/lib/workspace-transfer/auth';
import { exportWorkspace } from '@/lib/workspace-transfer/export';
import { buildWorkspaceZip } from '@/lib/workspace-transfer/archive';
import { WORKSPACE_FORMAT_VERSION } from '@/lib/workspace-transfer/format';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const rl = await applyRateLimit(request, 'workspace.export', RATE_READ);
  if (rl) return rl.blocked;

  try {
    const actor = await authorizeWorkspaceTransfer(request, 'read');
    if (actor instanceof NextResponse) return actor;

    const params = request.nextUrl.searchParams;
    const zip = params.get('format') === 'zip';

    // Service client: reads one workspace's rows after auth above. Accesses: workspaces, project_groups, projects, tasks, task_comments, task_attachments, agent_configs, brain tables, task-attachments storage.
    const db = createServiceClient();
    const exported = await exportWorkspace(db, actor.workspaceId, hostConfig.edition);
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `celune-workspace-${actor.workspaceId.slice(0, 8)}-${stamp}`;
    const headers = {
      'Cache-Control': 'no-store',
      'X-Workspace-Format-Version': String(WORKSPACE_FORMAT_VERSION),
    };

    if (zip) {
      const bytes = await buildWorkspaceZip(
        db,
        exported,
        { productName: hostConfig.productName, docsUrl: hostConfig.docsUrl },
        params.get('attachments') !== 'false',
      );
      return new NextResponse(bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          ...headers,
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${base}.zip"`,
        },
      });
    }

    return new NextResponse(JSON.stringify(exported.file), {
      status: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${base}.json"`,
      },
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
