import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { workspaceStateSchema } from '@/lib/schemas/workspace.schema';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import type { z } from 'zod';

type WorkspaceStateBody = z.infer<typeof workspaceStateSchema>;

export const POST = withApiSecurity<WorkspaceStateBody>(
  async (_request: NextRequest, { userId, body }: SecurityContext<WorkspaceStateBody>) => {
    const { workspace_id, workspace_name, slug } = body;

    // Verify the user is a member of the requested workspace (or org owner/admin)
    const { requireWorkspaceMembership } = await import('@/lib/require-workspace');
    const forbidden = await requireWorkspaceMembership(userId, workspace_id);
    if (forbidden) return forbidden;

    const stateDir = join(homedir(), '.claude', 'state');
    await mkdir(stateDir, { recursive: true });

    const statePath = join(stateDir, 'active-workspace.json');
    await writeFile(
      statePath,
      JSON.stringify({ workspace_id, workspace_name, slug, updated_at: new Date().toISOString() }),
    );

    return NextResponse.json({ ok: true });
  },
  {
    rateLimit: { tier: RATE_WRITE, routeKey: 'workspace-state.post' },
    parseBody: workspaceStateSchema,
  },
);
