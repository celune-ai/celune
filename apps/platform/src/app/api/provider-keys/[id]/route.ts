import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { validateOrigin } from '@/lib/csrf';
import { isValidUuid } from '@repo/db/validation';
import { auditLog } from '@/lib/audit-log';
import {
  decryptProviderKey,
  encryptProviderKey,
  extractKeySuffix,
  validateMasterKey,
} from '@/lib/provider-key-crypto';
import { applyRateLimit } from '@/lib/rate-limiter';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const RATE_VALIDATE = { limit: 5, windowMs: 600_000 } as const;

const rotateProviderKeySchema = z.object({ key: z.string().min(1) }).strip();

import type { SupportedProvider } from '@repo/types';

/**
 * Validate a provider API key by making a lightweight test call.
 */
async function validateProviderKey(provider: SupportedProvider, key: string): Promise<string> {
  try {
    switch (provider) {
      case 'anthropic': {
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
        if (res.status === 401 || res.status === 403) return 'invalid';
        if (res.status === 429) return 'rate_limited';
        return 'valid';
      }
      case 'openai': {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 401 || res.status === 403) return 'invalid';
        if (res.status === 429) return 'rate_limited';
        return 'valid';
      }
      case 'elevenlabs': {
        const res = await fetch('https://api.elevenlabs.io/v1/user', {
          headers: { 'xi-api-key': key },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 401 || res.status === 403) return 'invalid';
        if (res.status === 429) return 'rate_limited';
        return 'valid';
      }
      case 'groq': {
        const res = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 401 || res.status === 403) return 'invalid';
        if (res.status === 429) return 'rate_limited';
        return 'valid';
      }
      case 'google_gemini': {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(key)}`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (res.status === 400 || res.status === 401 || res.status === 403) return 'invalid';
        if (res.status === 429) return 'rate_limited';
        return 'valid';
      }
      case 'mistral': {
        const res = await fetch('https://api.mistral.ai/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 401 || res.status === 403) return 'invalid';
        if (res.status === 429) return 'rate_limited';
        return 'valid';
      }
      default:
        return 'invalid';
    }
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return 'timeout';
    }
    return 'invalid';
  }
}

/**
 * PATCH /api/provider-keys/[id]/validate
 * Re-validate a stored key by decrypting and testing against the provider.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originError = await validateOrigin(request);
  if (originError) return originError;

  const workspaceId = request.nextUrl.searchParams.get('workspace_id');
  const permResult = await requirePermission(request, workspaceId, 'settings:manage');
  if (permResult instanceof NextResponse) return permResult;

  try {
    const rateLimited = await applyRateLimit(request, 'provider-keys.validate', RATE_VALIDATE);
    if (rateLimited) return rateLimited.blocked;

    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid provider key ID' }, { status: 400 });
    }
    const supabase = createServiceClient();

    const { data: keyRow, error: fetchError } = await supabase
      .from('provider_api_keys')
      .select('id, provider, encrypted_key, key_iv, org_id')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (fetchError || !keyRow) {
      return NextResponse.json({ error: 'Key not found' }, { status: 404 });
    }

    // Verify org membership
    const { data: membership } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', permResult.userId)
      .eq('org_id', keyRow.org_id)
      .eq('is_active', true)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const decrypted = decryptProviderKey(keyRow.encrypted_key, keyRow.key_iv);
    const status = await validateProviderKey(keyRow.provider as SupportedProvider, decrypted);

    await supabase
      .from('provider_api_keys')
      .update({
        last_validated_at: new Date().toISOString(),
        last_validation_status: status,
      })
      .eq('id', id);

    return NextResponse.json({ last_validation_status: status });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * PUT /api/provider-keys/[id]
 * Rotate: validate the new key, deactivate the current row, insert a new row
 * with the same provider, name, and scope. The old row stays as history.
 * Requires settings:manage permission. Returns the new row's metadata.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originError = await validateOrigin(request);
  if (originError) return originError;

  const workspaceId = request.nextUrl.searchParams.get('workspace_id');
  const permResult = await requirePermission(request, workspaceId, 'settings:manage');
  if (permResult instanceof NextResponse) return permResult;

  try {
    const rateLimited = await applyRateLimit(request, 'provider-keys.validate', RATE_VALIDATE);
    if (rateLimited) return rateLimited.blocked;

    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid provider key ID' }, { status: 400 });
    }

    validateMasterKey();

    const parsed = await parseBody(request, rotateProviderKeySchema);
    if (isErrorResponse(parsed)) return parsed;

    // Service client: reads scope metadata, deactivates the old row, inserts the new ciphertext.
    // Never returns encrypted_key or key_iv. Accesses: provider_api_keys, org_members.
    const supabase = createServiceClient();

    const { data: existing, error: fetchError } = await supabase
      .from('provider_api_keys')
      .select('id, provider, name, org_id, workspace_id')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: 'Provider key not found or already deactivated' },
        { status: 404 },
      );
    }

    // The key must belong to the workspace the caller was authorized for.
    if ((existing.workspace_id ?? null) !== (workspaceId ?? null)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: membership } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', permResult.userId)
      .eq('org_id', existing.org_id)
      .eq('is_active', true)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const provider = existing.provider as SupportedProvider;
    const status = await validateProviderKey(provider, parsed.key);
    if (status !== 'valid') {
      return NextResponse.json({ error: `Key validation failed: ${status}` }, { status: 400 });
    }

    const { encryptedKey, iv } = encryptProviderKey(parsed.key);
    const now = new Date().toISOString();

    const { error: deactivateError } = await supabase
      .from('provider_api_keys')
      .update({ is_active: false })
      .eq('id', id);
    if (deactivateError) throw deactivateError;

    const { data: created, error: insertError } = await supabase
      .from('provider_api_keys')
      .insert({
        org_id: existing.org_id,
        workspace_id: existing.workspace_id ?? null,
        user_id: permResult.userId,
        provider,
        name: existing.name,
        encrypted_key: encryptedKey,
        key_iv: iv,
        key_suffix: extractKeySuffix(parsed.key),
        is_active: true,
        last_validated_at: now,
        last_validation_status: 'valid',
      })
      .select('id, provider, name, key_suffix, is_active, created_at')
      .single();

    if (insertError || !created) {
      await supabase.from('provider_api_keys').update({ is_active: true }).eq('id', id);
      throw insertError ?? new Error('Rotation insert returned no row');
    }

    auditLog(
      {
        event_type: 'provider_key.rotated',
        title: `Provider key rotated: ${existing.name} (${provider})`,
        actor_user_id: permResult.userId,
        workspace_id: existing.workspace_id ?? null,
        resource_type: 'provider_api_key',
        resource_id: created.id,
        before_state: { key_id: id },
        after_state: { key_id: created.id, key_suffix: created.key_suffix },
      },
      request,
    );

    return NextResponse.json(created);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * DELETE /api/provider-keys/[id]
 * Soft delete: sets is_active=false. The encrypted key data is retained for audit purposes.
 * Requires settings:manage permission.
 * Returns 204 on success.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = await validateOrigin(request);
  if (originError) return originError;

  const workspaceId = request.nextUrl.searchParams.get('workspace_id');
  const permResult = await requirePermission(request, workspaceId, 'settings:manage');
  if (permResult instanceof NextResponse) return permResult;

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid provider key ID' }, { status: 400 });
    }

    // Service client: soft-deletes provider key by setting is_active=false. Never exposes encrypted_key or key_iv.
    // Accesses: provider_api_keys.
    const supabase = createServiceClient();

    // Fetch before soft-delete to verify ownership and capture metadata for audit log
    const { data: existing, error: fetchError } = await supabase
      .from('provider_api_keys')
      .select('id, provider, name, org_id, workspace_id, is_active')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: 'Provider key not found or already deactivated' },
        { status: 404 },
      );
    }

    // Verify the requesting user belongs to the same org (defense-in-depth beyond permission check)
    const { data: membership } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', permResult.userId)
      .eq('org_id', existing.org_id)
      .eq('is_active', true)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Soft delete
    const { error: updateError } = await supabase
      .from('provider_api_keys')
      .update({ is_active: false })
      .eq('id', id);

    if (updateError) throw updateError;

    auditLog(
      {
        event_type: 'provider_key.deleted',
        title: `Provider key deleted: ${existing.name} (${existing.provider})`,
        actor_user_id: permResult.userId,
        workspace_id: existing.workspace_id ?? null,
        resource_type: 'provider_api_key',
        resource_id: id,
        before_state: {
          provider: existing.provider,
          name: existing.name,
          is_active: true,
        },
        after_state: { is_active: false },
      },
      request,
    );

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
