/**
 * Progressive Disclosure Skill Loader endpoint.
 *
 * GET /api/skills/load?workspace_id=<id>&tier=<tier>&category=<cat>
 *
 * Returns skills filtered by workspace tier with limit enforcement.
 * Used by the IDE/MCP to load only the skills the workspace is entitled to.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { safeErrorResponse } from '@/lib/api-error';
import { loadSkillsForWorkspace } from '@repo/db/skill-loader';
import type { BrainCategory } from '@repo/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId || !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Valid workspace_id is required' }, { status: 400 });
    }

    const forbidden = await requireWorkspaceMembership(userId, workspaceId);
    if (forbidden) return forbidden;

    // Accept plan names (cloud/enterprise, or legacy names) or brain tier names
    const tier =
      request.nextUrl.searchParams.get('plan') ??
      request.nextUrl.searchParams.get('tier') ??
      'cloud';
    const category = request.nextUrl.searchParams.get('category') as BrainCategory | null;
    const enabledOnly = request.nextUrl.searchParams.get('enabled_only') !== 'false';

    const result = await loadSkillsForWorkspace(workspaceId, tier, {
      category: category ?? undefined,
      enabledOnly,
    });

    return NextResponse.json(
      { data: result },
      {
        headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=30' },
      },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
