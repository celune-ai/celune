import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { getActivity, createActivity, acknowledgeActivities } from '@repo/db/queries';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { createActivitySchema, acknowledgeActivitySchema } from '@/lib/schemas/common.schema';
import { extractWorkspaceScope, requireWorkspaceMembership } from '@/lib/require-workspace';
import { getAuthUserId } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
import { applyRateLimit, RATE_READ, RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'activity.get', RATE_READ);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Workspace scope is required for activity list queries
    const wsScope = extractWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    // Verify membership for each workspace in the scope
    const wsIds = 'workspace_ids' in wsScope ? wsScope.workspace_ids! : [wsScope.workspace_id!];
    for (const wsId of wsIds) {
      const membershipError = await requireWorkspaceMembership(userId, wsId);
      if (membershipError) return membershipError;
    }

    const workspaceId =
      'workspace_id' in wsScope
        ? (wsScope.workspace_id ?? null)
        : (wsScope.workspace_ids?.[0] ?? null);
    const permResult = await requirePermission(request, workspaceId, 'analytics:read');
    if (permResult instanceof NextResponse) return permResult;

    const supabase = await createClient();
    const searchParams = request.nextUrl.searchParams;
    const event_type = searchParams.get('event_type') ?? undefined;
    const severity = searchParams.get('severity') ?? undefined;
    const severity_in_raw = searchParams.get('severity_in');
    const severity_in = severity_in_raw
      ? severity_in_raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const agent_id = searchParams.get('agent_id') ?? undefined;
    const task_id = searchParams.get('task_id') ?? undefined;
    const actor_user_id = searchParams.get('actor_user_id') ?? undefined;
    if (task_id && !isValidUuid(task_id)) {
      return NextResponse.json({ error: 'Invalid task_id' }, { status: 400 });
    }
    if (actor_user_id && !isValidUuid(actor_user_id)) {
      return NextResponse.json({ error: 'Invalid actor_user_id' }, { status: 400 });
    }
    const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;
    const offset = searchParams.get('offset') ? Number(searchParams.get('offset')) : undefined;

    const acknowledgedParam = searchParams.get('acknowledged');
    const acknowledged =
      acknowledgedParam === 'true' ? true : acknowledgedParam === 'false' ? false : undefined;

    const result = await getActivity(supabase, {
      event_type,
      severity,
      severity_in,
      agent_id,
      task_id,
      actor_user_id,
      acknowledged,
      limit,
      offset,
      ...wsScope,
    });
    return NextResponse.json(result);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

type AcknowledgeBody = z.infer<typeof acknowledgeActivitySchema>;

export const PATCH = withApiSecurity<AcknowledgeBody>(
  async (request: NextRequest, { body }: SecurityContext<AcknowledgeBody>) => {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }
    const supabase = await createClient();
    await acknowledgeActivities(supabase, body.ids, workspaceId);
    return NextResponse.json({ acknowledged: body.ids.length });
  },
  {
    permission: 'analytics:read',
    rateLimit: { tier: RATE_WRITE, routeKey: 'activity.patch' },
    parseBody: acknowledgeActivitySchema,
  },
);

type CreateActivityBody = z.infer<typeof createActivitySchema>;

export const POST = withApiSecurity<CreateActivityBody>(
  async (request: NextRequest, { body }: SecurityContext<CreateActivityBody>) => {
    const supabase = await createClient();

    const activity = await createActivity(supabase, {
      event_type: body.event_type,
      severity: body.severity,
      source: body.source,
      title: body.title,
      details: body.details,
      task_id: body.task_id,
      actor_user_id: body.actor_user_id ?? null,
    });

    return NextResponse.json(activity, { status: 201 });
  },
  {
    permission: 'analytics:read',
    rateLimit: { tier: RATE_WRITE, routeKey: 'activity.post' },
    parseBody: createActivitySchema,
  },
);
