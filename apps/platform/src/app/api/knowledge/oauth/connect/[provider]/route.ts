import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { getAuthUserId } from '@/lib/auth';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

/** Map UI provider IDs → Nango integration IDs */
const PROVIDER_TO_NANGO: Record<string, string> = {
  notion: 'notion',
  confluence: 'confluence',
  'google-drive': 'google-drive',
  gmail: 'google-mail',
  jira: 'jira',
  github: 'github-getting-started',
  linear: 'linear',
  asana: 'asana',
  dropbox: 'dropbox',
  figma: 'figma',
  slack: 'slack',
};

/**
 * GET /api/knowledge/oauth/connect/[provider]?workspace_id=...
 *
 * Creates a Nango Connect session token scoped to exactly one integration.
 * The frontend uses this token with Nango's JS SDK to trigger the OAuth
 * flow directly — since only one integration is allowed, it skips the
 * Nango picker and goes straight to the provider's OAuth page.
 *
 * Returns JSON: { token, provider, nangoIntegrationId }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const rateLimitResult = await applyRateLimit(request, 'knowledge.oauth.connect.get', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { provider } = await params;

    const nangoIntegrationId = PROVIDER_TO_NANGO[provider];
    if (!nangoIntegrationId) {
      return NextResponse.json(
        {
          error: `Unsupported provider: ${provider}. Supported: ${Object.keys(PROVIDER_TO_NANGO).join(', ')}`,
        },
        { status: 400 },
      );
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId || !isValidUuid(workspaceId)) {
      return NextResponse.json(
        { error: 'workspace_id query parameter is required' },
        { status: 400 },
      );
    }

    const membershipError = await requireWorkspaceMembership(userId, workspaceId);
    if (membershipError) return membershipError;

    const nangoSecretKey = process.env.NANGO_SECRET_KEY;
    if (!nangoSecretKey) {
      return NextResponse.json({ error: 'OAuth provider not configured' }, { status: 503 });
    }

    // Create a Nango Connect session scoped to exactly this one integration
    const sessionResponse = await fetch('https://api.nango.dev/connect/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${nangoSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        end_user: {
          id: userId,
          display_name: workspaceId,
        },
        organization: {
          id: workspaceId,
        },
        allowed_integrations: [nangoIntegrationId],
      }),
    });

    if (!sessionResponse.ok) {
      const errBody = await sessionResponse.text();
      console.error(
        '[knowledge/oauth] Nango session creation failed:',
        sessionResponse.status,
        errBody,
      );
      return NextResponse.json({ error: 'Failed to create OAuth session' }, { status: 502 });
    }

    const sessionData = await sessionResponse.json();
    const token = sessionData.data?.token ?? sessionData.token;

    if (!token) {
      console.error('[knowledge/oauth] No token in Nango response:', sessionData);
      return NextResponse.json({ error: 'Failed to create OAuth session' }, { status: 502 });
    }

    return NextResponse.json({
      token,
      provider,
      nangoIntegrationId,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
