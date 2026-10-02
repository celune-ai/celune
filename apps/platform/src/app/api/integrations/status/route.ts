import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { extractRequiredWorkspaceId } from '@/lib/require-workspace';
import type { IntegrationStatus, IntegrationStatusResult, KeySource } from '@repo/types';
import { getAllMemoryCounts } from '@/lib/seed-knowledge-packs';

export const dynamic = 'force-dynamic';

/**
 * GET /api/integrations/status?workspace_id=xxx
 *
 * Returns the connection status of all integrations for a workspace.
 * Single call powers the entire integrations settings tab.
 */
export async function GET(request: NextRequest) {
  try {
    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    const permResult = await requirePermission(request, workspaceId, 'settings:read');
    if (permResult instanceof NextResponse) return permResult;

    // Service client: reads workspace, provider keys, and slack connections for status aggregation.
    const supabase = createServiceClient();

    // Check if user is platform owner (only they should see server env integrations)
    const { data: ownerCheck } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', permResult.userId)
      .eq('role', 'platform_owner')
      .maybeSingle();
    const isPlatformOwner = !!ownerCheck;

    // Run all status checks in parallel
    const [workspaceRes, providerKeysRes, slackRes, subscriptionRes, apiKeysRes] =
      await Promise.all([
        supabase
          .from('workspaces')
          .select('repo_url, github_installation_id')
          .eq('id', workspaceId)
          .single(),
        supabase
          .from('provider_api_keys')
          .select('provider, last_validation_status, is_active')
          .eq('workspace_id', workspaceId)
          .eq('is_active', true),
        supabase
          .from('slack_connections')
          .select('id, is_active')
          .eq('workspace_id', workspaceId)
          .eq('is_active', true)
          .maybeSingle(),
        supabase
          .from('subscriptions')
          .select('status, plan')
          .eq('workspace_id', workspaceId)
          .in('status', ['active', 'trialing'])
          .maybeSingle(),
        supabase
          .from('api_keys')
          .select('id, name, environment')
          .eq('workspace_id', workspaceId)
          .is('revoked_at', null),
      ]);

    const workspace = workspaceRes.data;
    const providerKeys = providerKeysRes.data ?? [];
    const slackConnection = slackRes.data;
    const activeApiKeys = apiKeysRes.data ?? [];
    const subscription = subscriptionRes.data;

    const now = new Date().toISOString();

    // Map provider env vars for plan-key detection
    const PROVIDER_ENV: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      elevenlabs: 'ELEVENLABS_API_KEY',
      groq: 'GROQ_API_KEY',
      google_gemini: 'GOOGLE_GEMINI_API_KEY',
      mistral: 'MISTRAL_API_KEY',
    };

    // Build status for each provider key type
    const providerStatus = (
      provider: string,
    ): { status: IntegrationStatus; details?: string; key_source?: KeySource } => {
      const keys = providerKeys.filter((k) => k.provider === provider);
      const hasByokKey = keys.length > 0;
      // Only expose platform-level keys to platform owner
      const hasPlatformKey =
        isPlatformOwner && !!PROVIDER_ENV[provider] && !!process.env[PROVIDER_ENV[provider]];

      if (hasByokKey) {
        const valid = keys.find((k) => k.last_validation_status === 'valid');
        if (valid)
          return { status: 'connected', details: `${keys.length} key(s)`, key_source: 'byok' };
        return { status: 'error', details: 'Key validation failed', key_source: 'byok' };
      }
      if (hasPlatformKey) {
        return { status: 'connected', details: 'Using plan', key_source: 'plan' };
      }
      return { status: 'disconnected', key_source: null };
    };

    // Check platform-level env var integrations
    const envStatus = (envVar: string): IntegrationStatus =>
      process.env[envVar] ? 'connected' : 'not_configured';

    const results: IntegrationStatusResult[] = [
      // GitHub — workspace-level
      {
        id: 'github',
        status: workspace?.github_installation_id ? 'connected' : 'disconnected',
        details: workspace?.repo_url
          ? workspace.repo_url.replace('https://github.com/', '')
          : workspace?.github_installation_id
            ? 'App installed'
            : undefined,
        last_checked: now,
      },

      // AI Providers — workspace-level (BYOK)
      { id: 'anthropic', ...providerStatus('anthropic'), last_checked: now },
      { id: 'openai', ...providerStatus('openai'), last_checked: now },
      { id: 'elevenlabs', ...providerStatus('elevenlabs'), last_checked: now },
      { id: 'groq', ...providerStatus('groq'), last_checked: now },
      { id: 'google_gemini', ...providerStatus('google_gemini'), last_checked: now },
      { id: 'mistral', ...providerStatus('mistral'), last_checked: now },

      // Slack — workspace-level
      {
        id: 'slack',
        status: slackConnection ? 'connected' : 'disconnected',
        last_checked: now,
      },

      // Stripe — workspace-level (via subscription)
      {
        id: 'stripe',
        status: subscription ? 'connected' : 'disconnected',
        details: subscription ? `${subscription.plan} (${subscription.status})` : undefined,
        last_checked: now,
      },

      // IDE connections — detect from API key names
      ...(['cursor', 'windsurf', 'claude_code'] as const).map((ide) => {
        const patterns: Record<string, string[]> = {
          cursor: ['cursor', 'ide connection'],
          windsurf: ['windsurf', 'codeium'],
          claude_code: ['claude code', 'claude-code', 'cli'],
        };
        const connected = activeApiKeys.some((k) =>
          patterns[ide]!.some((p) => (k.name ?? '').toLowerCase().includes(p)),
        );
        return {
          id: ide,
          status: connected ? ('connected' as const) : ('disconnected' as const),
          last_checked: now,
        };
      }),
    ];

    // Platform-level integrations (env vars) — only visible to platform owner
    if (isPlatformOwner) {
      results.push(
        { id: 'sentry', status: envStatus('NEXT_PUBLIC_SENTRY_DSN'), last_checked: now },
        { id: 'railway', status: envStatus('RAILWAY_PROJECT_ID'), last_checked: now },
        {
          id: 'supabase',
          status: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'connected' : 'not_configured',
          details: 'Core infrastructure',
          last_checked: now,
        },
        { id: 'tavily', status: envStatus('TAVILY_API_KEY'), last_checked: now },
        { id: 'firecrawl', status: envStatus('FIRECRAWL_API_KEY'), last_checked: now },
        { id: 'agentmail', status: envStatus('AGENTMAIL_API_KEY'), last_checked: now },
      );
    }

    // TODO: Phase 2 — Add a cron endpoint (POST /api/integrations/health-check)
    // that pings each integration's healthCheckUrl and persists results to an
    // integration_health_checks table. The GET endpoint above would then read
    // cached health data instead of computing status on every request.

    const memoryCounts = getAllMemoryCounts();

    return NextResponse.json({ integrations: results, memoryCounts });
  } catch (err) {
    return safeErrorResponse(err);
  }
}
