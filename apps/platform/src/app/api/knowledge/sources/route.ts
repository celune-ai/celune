import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { extractRequiredWorkspaceId, requireWorkspaceMembership } from '@/lib/require-workspace';
import { getAuthUserId } from '@/lib/auth';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_READ, RATE_WRITE } from '@/lib/rate-limiter';

const VALID_PROVIDERS = [
  'notion',
  'confluence',
  'google-drive',
  'gmail',
  'github',
  'linear',
  'asana',
  'dropbox',
  'figma',
  'jira',
  'slack',
  'upload',
  'url',
] as const;

const CreateSourceSchema = z.object({
  provider: z.enum(VALID_PROVIDERS),
  display_name: z.string().min(1).max(200),
  nango_connection_id: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  sync_frequency_hours: z.number().int().min(1).max(168).optional(),
});

export const dynamic = 'force-dynamic';

/**
 * GET /api/knowledge/sources?workspace_id=...
 * List all knowledge sources for the workspace.
 */
export async function GET(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'knowledge.sources.get', RATE_READ);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    const membershipError = await requireWorkspaceMembership(userId, workspaceId);
    if (membershipError) return membershipError;

    const supabase = createServiceClient();

    const { data: sources, error } = await supabase
      .from('knowledge_sources')
      .select(
        'id, workspace_id, provider, display_name, status, sync_frequency_hours, items_count, storage_bytes, last_sync_at, nango_connection_id, created_at, updated_at',
      )
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json(sources ?? []);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * POST /api/knowledge/sources?workspace_id=...
 * Create a new knowledge source.
 * Body: { provider, display_name, config?, sync_frequency_hours? }
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'knowledge.sources.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    const membershipError = await requireWorkspaceMembership(userId, workspaceId);
    if (membershipError) return membershipError;

    const rawBody = await request.json();
    const parseResult = CreateSourceSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0]?.message ?? 'Invalid request body' },
        { status: 400 },
      );
    }
    const { provider, display_name, nango_connection_id, config, sync_frequency_hours } =
      parseResult.data;

    const supabase = createServiceClient();

    // Check for existing source with same provider (upsert-like behavior)
    const { data: existing } = await supabase
      .from('knowledge_sources')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('provider', provider)
      .maybeSingle();

    let source;
    if (existing) {
      // Update existing source (reconnection)
      const { data, error } = await supabase
        .from('knowledge_sources')
        .update({
          display_name,
          nango_connection_id: nango_connection_id ?? null,
          config: config ?? {},
          status: 'syncing',
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      source = data;
    } else {
      // Create new source
      const { data, error } = await supabase
        .from('knowledge_sources')
        .insert({
          workspace_id: workspaceId,
          provider,
          display_name,
          nango_connection_id: nango_connection_id ?? null,
          config: config ?? {},
          sync_frequency_hours: sync_frequency_hours ?? 4,
          status: 'syncing',
          items_count: 0,
          storage_bytes: 0,
          created_by: userId,
        })
        .select()
        .single();
      if (error) throw error;
      source = data;
    }

    // Trigger initial crawl in the background (fire-and-forget)
    // Uses PUT on the sync endpoint which runs the actual connector sync
    const syncUrl = new URL(`/api/knowledge/sources/${source.id}/sync`, request.nextUrl.origin);
    const cronSecretForSync = process.env.CRON_SECRET;
    if (!cronSecretForSync) {
      console.error('[knowledge/sources] CRON_SECRET not configured — skipping background sync');
    } else {
      fetch(syncUrl.toString(), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${cronSecretForSync}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }).catch((err) => {
        console.error(`[knowledge/sources] Failed to trigger initial sync for ${source.id}:`, err);
      });
    }

    return NextResponse.json(source, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
