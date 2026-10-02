import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { getAuthUserId } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

/**
 * GET /api/knowledge/oauth/callback
 * Nango redirects here after a successful OAuth flow.
 * Creates or updates the knowledge_source with the Nango connection,
 * triggers an initial sync, and redirects to the knowledge page.
 *
 * The user MUST be logged in (session cookie) so we can verify they
 * belong to the workspace encoded in the connectionId. Without this
 * check, an attacker could craft a callback URL targeting any workspace.
 *
 * Query params from Nango:
 *   - connectionId: the Nango connection ID (format: {workspace_id}_{provider})
 *   - providerConfigKey: the provider name/key in Nango
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const connectionId = searchParams.get('connectionId');
    const providerConfigKey = searchParams.get('providerConfigKey');
    const errorParam = searchParams.get('error');

    // Handle Nango error redirect
    if (errorParam) {
      console.error('[knowledge/oauth/callback] Nango error:', errorParam);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
      return NextResponse.redirect(
        `${appUrl}/knowledge?error=${encodeURIComponent('OAuth connection failed. Please try again.')}`,
      );
    }

    if (!connectionId || !providerConfigKey) {
      return NextResponse.json(
        { error: 'Missing connectionId or providerConfigKey' },
        { status: 400 },
      );
    }

    // Parse workspace_id and provider from connectionId (format: {workspace_id}_{provider})
    const lastUnderscore = connectionId.lastIndexOf('_');
    if (lastUnderscore === -1) {
      return NextResponse.json({ error: 'Invalid connectionId format' }, { status: 400 });
    }

    // UUID contains hyphens but not underscores at the boundary
    // connectionId format: {uuid}_{provider}
    const workspaceId = connectionId.substring(0, 36); // UUID is always 36 chars
    const provider = connectionId.substring(37); // Skip the underscore

    if (!isValidUuid(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace_id in connectionId' }, { status: 400 });
    }

    // ── Auth gate ────────────────────────────────────────────────────────
    // Verify the logged-in user belongs to this workspace.
    // The OAuth redirect happens in the same browser session, so the
    // session cookie is present. Without this check an attacker could
    // craft a callback URL targeting any workspace.
    const userId = getAuthUserId(request);
    if (!userId) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
      return NextResponse.redirect(
        `${appUrl}/knowledge?error=${encodeURIComponent('Authentication required. Please log in and try again.')}`,
      );
    }

    const membershipError = await requireWorkspaceMembership(userId, workspaceId);
    if (membershipError) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
      return NextResponse.redirect(
        `${appUrl}/knowledge?error=${encodeURIComponent('You do not have access to this workspace.')}`,
      );
    }

    const supabase = createServiceClient();

    // Check if source already exists for this workspace + provider
    const { data: existingSource } = await supabase
      .from('knowledge_sources')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('provider', provider)
      .single();

    let sourceId: string;

    if (existingSource) {
      // Update existing source with new connection
      const { error: updateError } = await supabase
        .from('knowledge_sources')
        .update({
          nango_connection_id: connectionId,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingSource.id);

      if (updateError) throw updateError;
      sourceId = existingSource.id;
    } else {
      // Create new source
      const displayName = provider.charAt(0).toUpperCase() + provider.slice(1).replace(/_/g, ' ');

      const { data: newSource, error: createError } = await supabase
        .from('knowledge_sources')
        .insert({
          workspace_id: workspaceId,
          provider,
          display_name: displayName,
          nango_connection_id: connectionId,
          status: 'active',
          config: {},
          sync_frequency_hours: 24,
          items_count: 0,
          storage_bytes: 0,
          created_by: userId,
        })
        .select('id')
        .single();

      if (createError) throw createError;
      sourceId = newSource.id;
    }

    // Trigger initial sync (fire-and-forget)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL;
    if (baseUrl) {
      const syncUrl = `${baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`}/api/knowledge/sources/${sourceId}/sync`;
      fetch(syncUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}`,
        },
      }).catch((err) => {
        console.error('[knowledge/oauth/callback] initial sync trigger failed:', err);
      });
    }

    // Redirect to knowledge page with success
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    // Use a workspace-agnostic redirect; the frontend router will resolve the workspace slug
    return NextResponse.redirect(`${appUrl}/knowledge?connected=${provider}&source_id=${sourceId}`);
  } catch (error) {
    console.error('[knowledge/oauth/callback] error:', error);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    return NextResponse.redirect(
      `${appUrl}/knowledge?error=${encodeURIComponent('Failed to complete OAuth connection.')}`,
    );
  }
}
