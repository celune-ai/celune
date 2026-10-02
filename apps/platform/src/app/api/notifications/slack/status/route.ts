import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { extractRequiredWorkspaceId } from '@/lib/require-workspace';
import { validateOrigin } from '@/lib/csrf';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { z } from 'zod';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

/**
 * GET /api/notifications/slack/status?workspace_id=xxx
 *
 * Returns whether the workspace has an active Slack connection
 * and the connected team/channel info (without exposing the webhook URL).
 */
export async function GET(request: NextRequest) {
  try {
    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    const permResult = await requirePermission(request, workspaceId, 'settings:read');
    if (permResult instanceof NextResponse) return permResult;

    // Service client: reads Slack connection status. Accesses: slack_connections.
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('slack_connections')
      .select(
        'id, slack_team_id, slack_team_name, slack_channel, is_active, created_at, installation_type, installed_scopes, bot_display_name',
      )
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows found — that's fine
      return safeErrorResponse(error);
    }

    if (!data) {
      return NextResponse.json({ connection: null });
    }

    return NextResponse.json({
      connection: {
        connected: true,
        team_id: data.slack_team_id,
        team_name: data.slack_team_name,
        channel: data.slack_channel,
        installation_type: data.installation_type ?? 'webhook',
        has_bot_scopes: Array.isArray(data.installed_scopes) && data.installed_scopes.length > 0,
        bot_display_name: data.bot_display_name ?? null,
      },
    });
  } catch (err) {
    return safeErrorResponse(err);
  }
}

/**
 * PATCH /api/notifications/slack/status
 *
 * Update bot display settings (custom bot name).
 * Body: { workspace_id, bot_display_name }
 */
export async function PATCH(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(
    request,
    'notifications.slack.status.patch',
    RATE_WRITE,
  );
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const patchSchema = z.object({
      workspace_id: z.string().uuid(),
      bot_display_name: z.string().max(80).nullable().optional(),
    });

    const parsed = await parseBody(request, patchSchema);
    if (isErrorResponse(parsed)) return parsed;

    const workspaceId = parsed.workspace_id;

    const permResult = await requirePermission(request, workspaceId, 'settings:manage');
    if (permResult instanceof NextResponse) return permResult;

    const displayName = parsed.bot_display_name?.trim() || null;

    const supabase = createServiceClient();
    const { error } = await supabase
      .from('slack_connections')
      .update({
        bot_display_name: displayName,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);

    if (error) {
      return safeErrorResponse(error);
    }

    return NextResponse.json({ success: true, bot_display_name: displayName });
  } catch (err) {
    return safeErrorResponse(err);
  }
}
