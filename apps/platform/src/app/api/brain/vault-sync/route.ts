/**
 * Vault Sync endpoint.
 *
 * GET  /api/brain/vault-sync?workspace_id=<id>     — list configured vault sources
 * POST /api/brain/vault-sync  { workspace_id, vault_path }  — add a vault source
 * DELETE /api/brain/vault-sync?workspace_id=<id>&vault_path=<path>  — remove a vault source
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_READ, RATE_WRITE } from '@/lib/rate-limiter';
import { readSyncConfig, isAllowedVaultRoot } from '@/lib/vault-sync';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  workspace_id: z.string().uuid(),
  vault_path: z.string().min(1).max(500),
});

export async function GET(request: NextRequest) {
  const rateLimitGet = await applyRateLimit(request, 'brain.vault-sync.list', RATE_READ);
  if (rateLimitGet) return rateLimitGet.blocked;

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

    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('vault_sync_sources')
      .select(
        'id, vault_path, sync_config, files_synced, chunks_created, status, last_synced_at, created_at',
      )
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[vault-sync] Query error:', error);
      return NextResponse.json({ error: 'Failed to load vault sources' }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;
  const rateLimitResult = await applyRateLimit(request, 'brain.vault-sync.create', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = createSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join('; ');
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const { workspace_id, vault_path } = parsed.data;

    const forbidden = await requireWorkspaceMembership(userId, workspace_id);
    if (forbidden) return forbidden;

    // Validate vault path is within allowed root directories (prevent path traversal)
    if (!isAllowedVaultRoot(vault_path)) {
      return NextResponse.json(
        { error: 'Vault path is outside allowed directories' },
        { status: 400 },
      );
    }

    // Check if .celune-sync exists in the vault
    const syncConfig = await readSyncConfig(vault_path);
    if (!syncConfig) {
      return NextResponse.json(
        {
          error:
            'No .celune-sync file found in vault root. Create one to specify which paths to sync.',
        },
        { status: 400 },
      );
    }

    if (syncConfig.allowedPaths.length === 0) {
      return NextResponse.json(
        { error: '.celune-sync file is empty. Add path patterns to specify which files to sync.' },
        { status: 400 },
      );
    }

    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('vault_sync_sources')
      .insert({
        workspace_id,
        vault_path,
        sync_config: syncConfig,
        status: 'pending',
      })
      .select('id, vault_path, sync_config, status, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'This vault path is already configured' },
          { status: 409 },
        );
      }
      console.error('[vault-sync] Insert error:', error);
      return NextResponse.json({ error: 'Failed to add vault source' }, { status: 500 });
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;
  const rateLimitResult = await applyRateLimit(request, 'brain.vault-sync.delete', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId || !isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Valid workspace_id is required' }, { status: 400 });
    }

    const sourceId = request.nextUrl.searchParams.get('source_id');
    if (!sourceId || !isValidUuid(sourceId)) {
      return NextResponse.json({ error: 'Valid source_id is required' }, { status: 400 });
    }

    const forbidden = await requireWorkspaceMembership(userId, workspaceId);
    if (forbidden) return forbidden;

    const supabase = createServiceClient();

    // Clean up synced memories for this specific source
    // Keys are formatted as vault-sync:{workspaceId}:{path}:chunk-N
    await supabase
      .from('agent_memory')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('source', 'vault-sync')
      .like('key', `vault-sync:${workspaceId}:%`);

    const { error } = await supabase
      .from('vault_sync_sources')
      .delete()
      .eq('id', sourceId)
      .eq('workspace_id', workspaceId);

    if (error) {
      console.error('[vault-sync] Delete error:', error);
      return NextResponse.json({ error: 'Failed to delete vault source' }, { status: 500 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
