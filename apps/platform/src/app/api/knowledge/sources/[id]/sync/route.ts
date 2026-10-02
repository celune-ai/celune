import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { getAuthUserId } from '@/lib/auth';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { runSync } from '@/lib/knowledge/sync-runner';

const SyncBodySchema = z
  .object({
    sync_id: z.string().uuid().optional(),
  })
  .optional();

export const dynamic = 'force-dynamic';

/**
 * POST /api/knowledge/sources/[id]/sync
 * Trigger a manual re-sync for a knowledge source.
 * Sets source status to 'syncing' and creates a sync record.
 * Returns 202 Accepted immediately — sync runs in background.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'knowledge.sources.sync.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: sourceId } = await params;
    if (!isValidUuid(sourceId)) {
      return NextResponse.json({ error: 'Invalid source ID' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Fetch source and verify access
    const { data: source, error: sourceError } = await supabase
      .from('knowledge_sources')
      .select('id, workspace_id, status, provider')
      .eq('id', sourceId)
      .single();

    if (sourceError || !source) {
      return NextResponse.json({ error: 'Knowledge source not found' }, { status: 404 });
    }

    const membershipError = await requireWorkspaceMembership(userId, source.workspace_id);
    if (membershipError) return membershipError;

    // Prevent sync if already syncing
    if (source.status === 'syncing') {
      return NextResponse.json({ error: 'Source is already syncing' }, { status: 409 });
    }

    // Set source status to syncing
    const { error: updateError } = await supabase
      .from('knowledge_sources')
      .update({ status: 'syncing', updated_at: new Date().toISOString() })
      .eq('id', sourceId);

    if (updateError) throw updateError;

    // Create a sync record to track this run
    const { data: syncRecord, error: syncError } = await supabase
      .from('knowledge_syncs')
      .insert({
        source_id: sourceId,
        workspace_id: source.workspace_id,
        status: 'running',
        started_at: new Date().toISOString(),
        triggered_by: userId,
      })
      .select('id')
      .single();

    if (syncError) throw syncError;

    // Kick off background ingest via internal endpoint
    // Fire-and-forget — don't await the response
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL;
    const cronSecretForSync = process.env.CRON_SECRET;
    if (baseUrl && cronSecretForSync) {
      const ingestUrl = `${baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`}/api/knowledge/sources/${sourceId}/sync`;
      fetch(ingestUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cronSecretForSync}`,
        },
        body: JSON.stringify({ sync_id: syncRecord.id }),
      }).catch((err) => {
        console.error('[knowledge/sync] background ingest trigger failed:', err);
      });
    }

    return NextResponse.json({ sync_id: syncRecord.id, status: 'syncing' }, { status: 202 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * PUT /api/knowledge/sources/[id]/sync
 * Internal background sync handler — called by POST fire-and-forget.
 * Authenticated via CRON_SECRET bearer token (not user session).
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Verify internal auth — CRON_SECRET only (no user header bypass)
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      console.error('[knowledge/sync] CRON_SECRET is not configured');
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: sourceId } = await params;
    if (!isValidUuid(sourceId)) {
      return NextResponse.json({ error: 'Invalid source ID' }, { status: 400 });
    }

    const rawBody = await request.json().catch(() => ({}));
    const parsed = SyncBodySchema.safeParse(rawBody);
    const syncId = parsed.success ? parsed.data?.sync_id : undefined;

    const supabase = createServiceClient();

    // Get workspace_id from source
    const { data: source } = await supabase
      .from('knowledge_sources')
      .select('workspace_id')
      .eq('id', sourceId)
      .single();

    if (!source) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    // Run the sync (handles retries, error recovery, status updates)
    const result = await runSync({
      sourceId,
      workspaceId: source.workspace_id,
      syncId,
    });

    return NextResponse.json(result);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
