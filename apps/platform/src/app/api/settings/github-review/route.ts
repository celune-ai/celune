/**
 * GET/PATCH /api/settings/github-review?workspace_id=...
 *
 * Manages PR review collaboration settings stored in workspace metadata.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { extractRequiredWorkspaceId } from '@/lib/require-workspace';
import { requirePermission } from '@/lib/permissions';
import { applyRateLimit, RATE_READ, RATE_WRITE } from '@/lib/rate-limiter';
import { validateOrigin } from '@/lib/csrf';
import { z } from 'zod';
import { parseBody, isErrorResponse } from '@/lib/parse-body';

export const dynamic = 'force-dynamic';

const DEFAULT_SETTINGS = {
  pr_summary_comments: true,
  agent_code_review: true,
  auto_complete_review_tasks: true,
};

// ---------------------------------------------------------------------------
// GET — read current settings
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'settings.github-review.get', RATE_READ);
  if (rateLimitResult) return rateLimitResult.blocked;

  const wsResult = extractRequiredWorkspaceId(request);
  if (wsResult instanceof NextResponse) return wsResult;
  const workspaceId = wsResult;

  const permResult = await requirePermission(request, workspaceId, 'settings:read');
  if (permResult instanceof NextResponse) return permResult;

  // Service client: reads workspace metadata for github review settings. Accesses: workspaces.
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('workspaces')
    .select('metadata')
    .eq('id', workspaceId)
    .single();

  const meta = (data?.metadata as Record<string, unknown>) ?? {};
  const settings = {
    ...DEFAULT_SETTINGS,
    ...((meta.github_review_settings as Record<string, unknown>) ?? {}),
  };

  return NextResponse.json(settings);
}

// ---------------------------------------------------------------------------
// PATCH — update settings
// ---------------------------------------------------------------------------

const updateSchema = z
  .object({
    pr_summary_comments: z.boolean().optional(),
    agent_code_review: z.boolean().optional(),
    auto_complete_review_tasks: z.boolean().optional(),
  })
  .strip();

export async function PATCH(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'settings.github-review.patch', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  const wsResult = extractRequiredWorkspaceId(request);
  if (wsResult instanceof NextResponse) return wsResult;
  const workspaceId = wsResult;

  const permResult = await requirePermission(request, workspaceId, 'settings:manage');
  if (permResult instanceof NextResponse) return permResult;

  const parsed = await parseBody(request, updateSchema);
  if (isErrorResponse(parsed)) return parsed;

  // Service client: reads + updates workspace metadata for github review settings. Accesses: workspaces.
  const supabase = createServiceClient();

  // Read current metadata
  const { data: ws } = await supabase
    .from('workspaces')
    .select('metadata')
    .eq('id', workspaceId)
    .single();

  const currentMeta = (ws?.metadata as Record<string, unknown>) ?? {};
  const currentSettings = (currentMeta.github_review_settings as Record<string, unknown>) ?? {};

  // Merge new values over defaults + current
  const newSettings = { ...DEFAULT_SETTINGS, ...currentSettings, ...parsed };
  const newMeta = { ...currentMeta, github_review_settings: newSettings };

  const { error } = await supabase
    .from('workspaces')
    .update({ metadata: newMeta })
    .eq('id', workspaceId);

  if (error) {
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }

  return NextResponse.json(newSettings);
}
