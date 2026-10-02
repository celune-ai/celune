import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { validateOrigin } from '@/lib/csrf';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { createApiKeySchema } from '@/lib/schemas/api-keys.schema';
import { generateApiKey } from '@/lib/api-keys';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { trackUsage } from '@/lib/track-usage';
import { auditLog } from '@/lib/audit-log';
import { createPlatformGate } from '@/lib/gate';
import { workspaceScope } from '@/lib/core';

export const dynamic = 'force-dynamic';

/** Map legacy coarse scopes to granular permission keys */
function mapScopesToPermissions(scopes: string[]): string[] {
  if (scopes.includes('admin')) {
    return [
      'tasks:create',
      'tasks:read',
      'tasks:update',
      'tasks:delete',
      'projects:create',
      'projects:read',
      'projects:update',
      'projects:delete',
      'users:read',
      'settings:read',
      'agents:configure',
      'agents:read',
      'analytics:read',
      'webhooks:manage',
      'webhooks:read',
      'api_keys:read',
      'audit_log:read',
    ];
  }
  if (scopes.includes('write')) {
    return [
      'tasks:create',
      'tasks:read',
      'tasks:update',
      'projects:create',
      'projects:read',
      'projects:update',
      'agents:read',
      'analytics:read',
    ];
  }
  return ['tasks:read', 'projects:read', 'agents:read', 'analytics:read'];
}

/**
 * GET /api/api-keys?workspace_id=xxx
 * List API keys for a workspace (owner/admin only). Never returns key_hash.
 */
export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');

    const permResult = await requirePermission(request, workspaceId, 'api_keys:read');
    if (permResult instanceof NextResponse) return permResult;
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const includeOrg = request.nextUrl.searchParams.get('include_org') === 'true';

    let query = supabase
      .from('api_keys')
      .select(
        'id, workspace_id, org_id, user_id, name, key_prefix, environment, scopes, permission_scopes, rate_limit_per_minute, realtime_enabled, client_metadata, last_used_at, expires_at, revoked_at, created_at, updated_at',
      )
      .order('created_at', { ascending: false });

    if (includeOrg) {
      // Include keys from all workspaces in the same org
      const { data: ws } = await supabase
        .from('workspaces')
        .select('org_id')
        .eq('id', workspaceId)
        .single();

      if (ws?.org_id) {
        const { data: orgWorkspaces } = await supabase
          .from('workspaces')
          .select('id')
          .eq('org_id', ws.org_id);

        const wsIds = (orgWorkspaces ?? []).map((w) => w.id);
        query = query.in('workspace_id', wsIds);
      } else {
        query = query.eq('workspace_id', workspaceId);
      }
    } else {
      query = query.eq('workspace_id', workspaceId);
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * POST /api/api-keys
 * Create a new API key (owner/admin only).
 * Returns the plaintext key ONCE — it cannot be retrieved again.
 */
export async function POST(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;

  const rateLimitResult = await applyRateLimit(request, 'api-keys.create', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const parsed = await parseBody(request, createApiKeySchema);
    if (isErrorResponse(parsed)) return parsed;

    // Pass workspace_id so permission resolver can find org ownership
    const permResult = await requirePermission(
      request,
      parsed.workspace_id ?? null,
      'api_keys:manage',
    );
    if (permResult instanceof NextResponse) return permResult;

    // Suspension and plan limits for key creation
    if (parsed.workspace_id) {
      const verdict = await createPlatformGate().check('api_key.create', {
        scope: workspaceScope({ workspaceId: parsed.workspace_id, actorId: permResult.userId }),
        userId: permResult.userId,
      });
      if (!verdict.allowed) {
        return NextResponse.json(verdict.details ?? { error: verdict.reason }, {
          status: verdict.status ?? 403,
        });
      }
    }

    const { key, hash, prefix } = generateApiKey(parsed.environment);

    // Map coarse scopes to permission keys if permission_scopes not provided
    const permissionScopes =
      parsed.permission_scopes ?? mapScopesToPermissions(parsed.scopes ?? []);

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('api_keys')
      .insert({
        workspace_id: parsed.workspace_id,
        user_id: permResult.userId,
        name: parsed.name,
        key_hash: hash,
        key_prefix: prefix,
        environment: parsed.environment,
        scopes: parsed.scopes,
        permission_scopes: permissionScopes,
        rate_limit_per_minute: parsed.rate_limit_per_minute ?? 100,
        expires_at: parsed.expires_at ?? null,
      })
      .select(
        'id, workspace_id, org_id, user_id, name, key_prefix, environment, scopes, permission_scopes, rate_limit_per_minute, expires_at, created_at',
      )
      .single();

    if (error) throw error;

    // Audit log API key creation
    auditLog(
      {
        event_type: 'api_key.created',
        title: `API key created: ${parsed.name}`,
        actor_user_id: permResult.userId,
        workspace_id: parsed.workspace_id,
        resource_type: 'api_key',
        resource_id: data.id,
        after_state: { name: parsed.name, environment: parsed.environment, scopes: parsed.scopes },
      },
      request,
    );

    // Track API key creation
    trackUsage({
      workspace_id: parsed.workspace_id,
      user_id: permResult.userId,
      event_type: 'api_call',
      quantity: 1,
      unit: 'count',
      metadata: { action: 'api_key_created', key_name: parsed.name },
    });

    // Return the key data with the plaintext key (shown once)
    return NextResponse.json({ ...data, plaintext_key: key }, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
