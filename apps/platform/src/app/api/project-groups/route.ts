import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { getProjectGroups, createProjectGroup, createActivity } from '@repo/db/queries';
import { safeErrorResponse } from '@/lib/api-error';
import { createProjectGroupSchema } from '@/lib/schemas/projects.schema';
import { extractWorkspaceScope } from '@/lib/require-workspace';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Workspace scope is required for project group list queries
    const wsScope = extractWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    const supabase = await createClient();
    const groups = await getProjectGroups(supabase, wsScope);
    return NextResponse.json(groups, {
      headers: { 'Cache-Control': 'private, max-age=120, stale-while-revalidate=30' },
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

type CreateGroupBody = z.infer<typeof createProjectGroupSchema>;

export const POST = withApiSecurity<CreateGroupBody>(
  async (request: NextRequest, { userId, body }: SecurityContext<CreateGroupBody>) => {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }
    const supabase = await createClient();
    const group = await createProjectGroup(supabase, { ...body, workspace_id: workspaceId });

    await createActivity(supabase, {
      event_type: 'project_group.created',
      severity: 'info',
      source: 'web',
      title: `Project group created: ${group.name ?? body.name}`,
      actor_user_id: userId,
    });

    return NextResponse.json(group, { status: 201 });
  },
  { permission: 'projects:create', parseBody: createProjectGroupSchema },
);
