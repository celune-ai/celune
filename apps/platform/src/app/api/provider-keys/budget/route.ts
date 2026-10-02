import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { requirePermission } from '@/lib/permissions';
import { validateOrigin } from '@/lib/csrf';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { auditLog } from '@/lib/audit-log';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { hostConfig } from '@/lib/host-config';
import { hostFallbackKeysEnabled } from '@/lib/resolve-provider-key';
import { getWorkspaceAiBudget } from '@/lib/ai-budget';

export const dynamic = 'force-dynamic';

const MAX_TOKEN_LIMIT = 1_000_000_000_000;
const MAX_RPM = 100_000;

const budgetSchema = z
  .object({
    token_limit_monthly: z.number().int().min(0).max(MAX_TOKEN_LIMIT).nullable(),
    requests_per_minute: z.number().int().min(0).max(MAX_RPM).nullable(),
  })
  .strip();

function requireWorkspaceId(request: NextRequest): string | NextResponse {
  const workspaceId = request.nextUrl.searchParams.get('workspace_id');
  if (!workspaceId || !isValidUuid(workspaceId)) {
    return NextResponse.json(
      { error: 'workspace_id query parameter is required' },
      { status: 400 },
    );
  }
  return workspaceId;
}

async function budgetPayload(workspaceId: string) {
  const budget = await getWorkspaceAiBudget(workspaceId);
  let trial: { budget: number; used: number } | null = null;
  if (hostFallbackKeysEnabled()) {
    // Service client: trial counters are read for display only. Accesses: workspaces.
    const { data } = await createServiceClient()
      .from('workspaces')
      .select('trial_token_budget, trial_tokens_used')
      .eq('id', workspaceId)
      .maybeSingle();
    if (data) trial = { budget: data.trial_token_budget ?? 0, used: data.trial_tokens_used ?? 0 };
  }
  return {
    edition: hostConfig.edition,
    host_fallback_enabled: hostFallbackKeysEnabled(),
    token_limit_monthly: budget.tokenLimitMonthly,
    requests_per_minute: budget.requestsPerMinute,
    tokens_used_month: budget.tokensUsedMonth,
    period_start: budget.periodStart,
    trial,
  };
}

/**
 * GET /api/provider-keys/budget?workspace_id=xxx
 * Edition, host fallback availability, the workspace AI limits, and this month's usage.
 */
export async function GET(request: NextRequest) {
  const workspaceId = requireWorkspaceId(request);
  if (workspaceId instanceof NextResponse) return workspaceId;

  const permResult = await requirePermission(request, workspaceId, 'settings:read');
  if (permResult instanceof NextResponse) return permResult;

  try {
    return NextResponse.json(await budgetPayload(workspaceId));
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * PUT /api/provider-keys/budget?workspace_id=xxx
 * Set the monthly token cap and per-minute request cap. null clears a cap.
 */
export async function PUT(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;

  const workspaceId = requireWorkspaceId(request);
  if (workspaceId instanceof NextResponse) return workspaceId;

  const permResult = await requirePermission(request, workspaceId, 'settings:manage');
  if (permResult instanceof NextResponse) return permResult;

  try {
    const rateLimited = await applyRateLimit(request, 'provider-keys.budget', RATE_WRITE);
    if (rateLimited) return rateLimited.blocked;

    const parsed = await parseBody(request, budgetSchema);
    if (isErrorResponse(parsed)) return parsed;

    // Service client: writes workspace limits after the permission check above. Accesses: workspaces.
    const supabase = createServiceClient();
    const { data: before } = await supabase
      .from('workspaces')
      .select('ai_token_limit_monthly, ai_requests_per_minute')
      .eq('id', workspaceId)
      .maybeSingle();
    if (!before) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const { error } = await supabase
      .from('workspaces')
      .update({
        ai_token_limit_monthly: parsed.token_limit_monthly,
        ai_requests_per_minute: parsed.requests_per_minute,
      })
      .eq('id', workspaceId);
    if (error) throw error;

    auditLog(
      {
        event_type: 'workspace.ai_budget_updated',
        title: 'Workspace AI budget updated',
        actor_user_id: permResult.userId,
        workspace_id: workspaceId,
        resource_type: 'workspace',
        resource_id: workspaceId,
        before_state: {
          token_limit_monthly: before.ai_token_limit_monthly ?? null,
          requests_per_minute: before.ai_requests_per_minute ?? null,
        },
        after_state: parsed,
      },
      request,
    );

    return NextResponse.json(await budgetPayload(workspaceId));
  } catch (error) {
    return safeErrorResponse(error);
  }
}
