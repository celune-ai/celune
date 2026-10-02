import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { validateOrigin } from '@/lib/csrf';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { encryptProviderKey, extractKeySuffix, validateMasterKey } from '@/lib/provider-key-crypto';
import { auditLog } from '@/lib/audit-log';
import { applyRateLimit } from '@/lib/rate-limiter';
import { z } from 'zod';
import { SUPPORTED_PROVIDERS, type SupportedProvider } from '@repo/types';

/** 5 requests per 10 minutes — each POST triggers an outbound provider API call */
const RATE_PROVIDER_KEY = { limit: 5, windowMs: 600_000 } as const;

export const dynamic = 'force-dynamic';

const createProviderKeySchema = z
  .object({
    provider: z.enum(SUPPORTED_PROVIDERS),
    name: z.string().min(1).max(255),
    key: z.string().min(1),
    // workspace_id is intentionally NOT accepted from the request body.
    // It is taken exclusively from the query param, which is validated by requirePermission().
    // Accepting workspace_id from the body would allow callers to authenticate against one
    // workspace while writing to a different one (IDOR).
  })
  .strip();

/**
 * Validate a provider API key by making a lightweight test call.
 * Returns null on success, or an error message string on failure.
 */
async function validateProviderKey(
  provider: SupportedProvider,
  key: string,
): Promise<string | null> {
  try {
    switch (provider) {
      case 'anthropic': {
        // Cheapest validation: messages API with max_tokens=1
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 401 || res.status === 403) return 'Invalid Anthropic API key';
        if (!res.ok && res.status !== 400) return `Anthropic API error: ${res.status}`;
        return null;
      }

      case 'openai': {
        // Models list is free/lightweight
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 401 || res.status === 403) return 'Invalid OpenAI API key';
        if (!res.ok) return `OpenAI API error: ${res.status}`;
        return null;
      }

      case 'elevenlabs': {
        // User endpoint is lightweight and auth-gated
        const res = await fetch('https://api.elevenlabs.io/v1/user', {
          headers: { 'xi-api-key': key },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 401 || res.status === 403) return 'Invalid ElevenLabs API key';
        if (!res.ok) return `ElevenLabs API error: ${res.status}`;
        return null;
      }

      case 'groq': {
        // Models list is lightweight
        const res = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 401 || res.status === 403) return 'Invalid Groq API key';
        if (!res.ok) return `Groq API error: ${res.status}`;
        return null;
      }

      case 'google_gemini': {
        // Models list with API key query param (Gemini uses key= not Bearer)
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(key)}`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (res.status === 400 || res.status === 401 || res.status === 403)
          return 'Invalid Google Gemini API key';
        if (!res.ok) return `Google Gemini API error: ${res.status}`;
        return null;
      }

      case 'mistral': {
        // OpenAI-compatible models endpoint
        const res = await fetch('https://api.mistral.ai/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 401 || res.status === 403) return 'Invalid Mistral API key';
        if (!res.ok) return `Mistral API error: ${res.status}`;
        return null;
      }

      default:
        return `Unsupported provider: ${provider}`;
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return 'Provider API timed out. Please try again.';
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      return 'Provider API timed out. Please try again.';
    }
    console.error('[provider-keys] Key validation error:', err);
    return 'Key validation failed. Please check the key and try again.';
  }
}

/**
 * GET /api/provider-keys?workspace_id=xxx
 * List provider key metadata for an org/workspace.
 * NEVER returns encrypted_key or key_iv.
 */
export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');

    const permResult = await requirePermission(request, workspaceId, 'settings:read');
    if (permResult instanceof NextResponse) return permResult;

    // Service client: reads provider key metadata. Never selects encrypted_key or key_iv.
    // Accesses: provider_api_keys, workspaces.
    const supabase = createServiceClient();

    const includeInactive = request.nextUrl.searchParams.get('include_inactive') === 'true';

    let query = supabase
      .from('provider_api_keys')
      .select(
        'id, provider, name, key_suffix, is_active, last_used_at, last_validated_at, last_validation_status, created_at, updated_at',
      )
      .order('created_at', { ascending: false });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    } else {
      // Org-wide keys: resolve org_id from user membership
      const { data: membership } = await supabase
        .from('org_members')
        .select('org_id')
        .eq('user_id', permResult.userId)
        .eq('is_active', true)
        .limit(1)
        .single();

      if (!membership?.org_id) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
      }
      query = query.eq('org_id', membership.org_id).is('workspace_id', null);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * POST /api/provider-keys
 * Encrypt and store a new provider API key.
 * Validates the key against the provider before saving.
 * Returns metadata only — never the plaintext or encrypted key.
 */
export async function POST(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;

  const workspaceIdParam = request.nextUrl.searchParams.get('workspace_id');
  const permResult = await requirePermission(request, workspaceIdParam, 'settings:manage');
  if (permResult instanceof NextResponse) return permResult;

  try {
    // Rate limit: each POST triggers an outbound provider API call
    const rateLimited = await applyRateLimit(request, 'provider-keys.create', RATE_PROVIDER_KEY);
    if (rateLimited) return rateLimited.blocked;

    // Ensure encryption is configured before accepting any key material
    validateMasterKey();

    const parsed = await parseBody(request, createProviderKeySchema);
    if (isErrorResponse(parsed)) return parsed;

    const { provider, name, key } = parsed;

    // Use workspace_id from the query param (already permission-checked above).
    // Ignore any workspace_id in the body — accepting it would allow a caller to pass
    // a different workspace in the body than the one they were authorized for (IDOR).
    const workspace_id = workspaceIdParam ?? undefined;

    // Validate the key actually works before storing it
    const validationError = await validateProviderKey(provider, key);
    if (validationError) {
      return NextResponse.json(
        { error: `Key validation failed: ${validationError}` },
        { status: 400 },
      );
    }

    // Resolve org_id
    // Service client: resolves org membership for org_id. Accesses: org_members, workspaces.
    const supabase = createServiceClient();

    let orgId: string | null = null;

    if (workspace_id) {
      const { data: workspace } = await supabase
        .from('workspaces')
        .select('org_id')
        .eq('id', workspace_id)
        .single();
      orgId = workspace?.org_id ?? null;
    } else {
      const { data: membership } = await supabase
        .from('org_members')
        .select('org_id')
        .eq('user_id', permResult.userId)
        .eq('is_active', true)
        .limit(1)
        .single();
      orgId = membership?.org_id ?? null;
    }

    if (!orgId) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Encrypt and extract suffix
    const { encryptedKey, iv } = encryptProviderKey(key);
    const keySuffix = extractKeySuffix(key);

    // Service client: inserts encrypted provider key. Never stores plaintext.
    // Accesses: provider_api_keys.
    const { data, error } = await supabase
      .from('provider_api_keys')
      .insert({
        org_id: orgId,
        workspace_id: workspace_id ?? null,
        user_id: permResult.userId,
        provider,
        name,
        encrypted_key: encryptedKey,
        key_iv: iv,
        key_suffix: keySuffix,
        is_active: true,
        last_validated_at: new Date().toISOString(),
        last_validation_status: 'valid',
      })
      .select('id, provider, name, key_suffix, created_at')
      .single();

    if (error) {
      // Unique constraint violation: one active key per provider per workspace
      if (error.code === '23505') {
        return NextResponse.json(
          {
            error: `An active ${provider} key already exists for this ${workspace_id ? 'workspace' : 'organization'}. Delete the existing key first.`,
          },
          { status: 409 },
        );
      }
      throw error;
    }

    auditLog(
      {
        event_type: 'provider_key.created',
        title: `Provider key created: ${name} (${provider})`,
        actor_user_id: permResult.userId,
        workspace_id: workspace_id ?? null,
        resource_type: 'provider_api_key',
        resource_id: data.id,
        after_state: { provider, name, key_suffix: keySuffix },
      },
      request,
    );

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
