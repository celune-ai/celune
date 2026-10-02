import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { assertHostJwtSecret, embedTokenGrant, mintHostJwt } from '@celuneai/api';
import { createServiceClient } from '@repo/db/service';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import { RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

const EMBED_TOKEN_TTL_SECONDS = 600;

/**
 * POST /api/embed/token?workspace_id=...
 *
 * Mints a short-lived host JWT for the signed-in user so the board talks to
 * /api/v1 the same way an embedding host does. The token carries only the
 * task and project keys v1 checks that the user holds, read keys included, and
 * the write scope only when one of them is a write key. v1 then allows each
 * write only when the token holds that operation's key.
 */
export const POST = withApiSecurity(
  async (request: NextRequest, { userId, permissionContext }: SecurityContext) => {
    const secret = process.env.CELUNE_HOST_JWT_SECRET?.trim();
    if (!secret) {
      return NextResponse.json({ error: 'Embed tokens are not configured' }, { status: 503 });
    }
    try {
      assertHostJwtSecret(secret);
    } catch (error) {
      console.error(`[embed-token] ${(error as Error).message}`);
      return NextResponse.json({ error: 'Embed tokens are not configured' }, { status: 503 });
    }
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId || !permissionContext) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }

    const { scopes, permissions } = embedTokenGrant(permissionContext.resolved.permissions);

    // Service client: reads the workspace's org id for the token claim. Accesses: workspaces.
    const { data: workspace } = await createServiceClient()
      .from('workspaces')
      .select('org_id')
      .eq('id', workspaceId)
      .maybeSingle();

    const token = await mintHostJwt(
      {
        sub: userId,
        workspace_id: workspaceId,
        org_id: workspace?.org_id ?? null,
        scopes,
        permissions,
      },
      {
        secret,
        expiresInSeconds: EMBED_TOKEN_TTL_SECONDS,
        issuer: process.env.CELUNE_HOST_JWT_ISSUER?.trim() || undefined,
        audience: process.env.CELUNE_HOST_JWT_AUDIENCE?.trim() || undefined,
      },
    );
    return NextResponse.json(
      { token, expires_in: EMBED_TOKEN_TTL_SECONDS },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  },
  {
    permission: 'tasks:read',
    rateLimit: { tier: RATE_READ, routeKey: 'embed.token' },
  },
);
