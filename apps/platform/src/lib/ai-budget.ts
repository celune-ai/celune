/**
 * Per-workspace AI budget: monthly token cap, per-minute request throttle,
 * and the single place LLM token usage is recorded.
 *
 * Server-side only. resolveProviderKey() calls assertWorkspaceAiBudget()
 * before handing out any key, so BYOK and host-provided keys share one limit.
 */

import { createServiceClient } from '@repo/db/service';
import { trackUsage, trackTrialUsage } from '@/lib/track-usage';
import type { KeySource, Provider } from '@/lib/resolve-provider-key';

/** usage_events types that count toward the monthly token cap. */
const TOKEN_EVENT_TYPES = new Set(['llm_tokens', 'execution']);
const MINUTE_MS = 60_000;

export interface WorkspaceAiLimits {
  tokenLimitMonthly: number | null;
  requestsPerMinute: number | null;
}

export interface WorkspaceAiBudget extends WorkspaceAiLimits {
  tokensUsedMonth: number;
  periodStart: string;
}

export type AiBudgetKind = 'monthly_tokens' | 'requests_per_minute';

export class AiBudgetExceededError extends Error {
  public readonly kind: AiBudgetKind;
  public readonly limit: number;
  public readonly used: number;
  public readonly retryAfterMs: number;

  constructor(kind: AiBudgetKind, limit: number, used: number, retryAfterMs = 0) {
    super(
      kind === 'monthly_tokens'
        ? `Workspace AI token budget reached (${used}/${limit} this month).`
        : `Workspace AI request limit reached (${limit} per minute).`,
    );
    this.name = 'AiBudgetExceededError';
    this.kind = kind;
    this.limit = limit;
    this.used = used;
    this.retryAfterMs = retryAfterMs;
  }
}

/** First instant of the current UTC calendar month. */
export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// Per-instance sliding window; a multi-instance deploy gets a looser cap, never a tighter one.
const requestLog = new Map<string, number[]>();

export function checkRequestThrottle(
  workspaceId: string,
  limit: number,
  now: number = Date.now(),
): { allowed: boolean; retryAfterMs: number } {
  const cutoff = now - MINUTE_MS;
  const recent = (requestLog.get(workspaceId) ?? []).filter((t) => t > cutoff);
  if (recent.length >= limit) {
    requestLog.set(workspaceId, recent);
    return { allowed: false, retryAfterMs: Math.max(0, recent[0]! + MINUTE_MS - now) };
  }
  recent.push(now);
  requestLog.set(workspaceId, recent);
  return { allowed: true, retryAfterMs: 0 };
}

/** Test hook: clear the in-memory throttle state. */
export function resetRequestThrottle(): void {
  requestLog.clear();
}

// Service client: limits are read before the caller's row access is established. Accesses: workspaces.
async function readLimits(workspaceId: string): Promise<WorkspaceAiLimits> {
  const { data } = await createServiceClient()
    .from('workspaces')
    .select('ai_token_limit_monthly, ai_requests_per_minute')
    .eq('id', workspaceId)
    .maybeSingle();
  return {
    tokenLimitMonthly: data?.ai_token_limit_monthly ?? null,
    requestsPerMinute: data?.ai_requests_per_minute ?? null,
  };
}

// Service client: sums metering rows users cannot read directly. Accesses: usage_events via sum_usage_events.
async function readTokensUsed(workspaceId: string, since: Date): Promise<number> {
  const { data } = await createServiceClient().rpc('sum_usage_events', {
    p_workspace_id: workspaceId,
    p_since: since.toISOString(),
  });
  const rows = (data ?? []) as Array<{ event_type: string; total: number | string | null }>;
  return rows
    .filter((r) => TOKEN_EVENT_TYPES.has(r.event_type))
    .reduce((sum, r) => sum + Number(r.total ?? 0), 0);
}

export async function getWorkspaceAiBudget(workspaceId: string): Promise<WorkspaceAiBudget> {
  const since = monthStart();
  const [limits, tokensUsedMonth] = await Promise.all([
    readLimits(workspaceId),
    readTokensUsed(workspaceId, since),
  ]);
  return { ...limits, tokensUsedMonth, periodStart: since.toISOString() };
}

/**
 * Throws AiBudgetExceededError when the workspace is over its per-minute
 * request cap or its monthly token cap. Unlimited (NULL) limits cost no reads.
 */
export async function assertWorkspaceAiBudget(workspaceId: string): Promise<void> {
  const limits = await readLimits(workspaceId);

  if (limits.requestsPerMinute !== null) {
    const throttle = checkRequestThrottle(workspaceId, limits.requestsPerMinute);
    if (!throttle.allowed) {
      throw new AiBudgetExceededError(
        'requests_per_minute',
        limits.requestsPerMinute,
        limits.requestsPerMinute,
        throttle.retryAfterMs,
      );
    }
  }

  if (limits.tokenLimitMonthly !== null) {
    const used = await readTokensUsed(workspaceId, monthStart());
    if (used >= limits.tokenLimitMonthly) {
      throw new AiBudgetExceededError('monthly_tokens', limits.tokenLimitMonthly, used);
    }
  }
}

export interface LlmUsageParams {
  workspaceId: string;
  orgId?: string | null;
  userId?: string | null;
  provider: Provider;
  model?: string;
  source: KeySource;
  /** Which platform surface made the call, for example `agent_chat` or `task_generate`. */
  feature: string;
  inputTokens: number;
  outputTokens: number;
  metadata?: Record<string, unknown>;
}

/**
 * Record one LLM call. Writes an llm_tokens usage event and, for host-provided
 * trial keys, decrements the workspace trial budget. Fire-and-forget.
 */
export function recordLlmUsage(params: LlmUsageParams): void {
  const total = (params.inputTokens ?? 0) + (params.outputTokens ?? 0);
  if (!params.workspaceId || total <= 0) return;

  trackUsage({
    workspace_id: params.workspaceId,
    org_id: params.orgId ?? null,
    user_id: params.userId ?? null,
    event_type: 'llm_tokens',
    quantity: total,
    unit: 'tokens',
    metadata: {
      provider: params.provider,
      model: params.model,
      feature: params.feature,
      key_source: params.source,
      input_tokens: params.inputTokens,
      output_tokens: params.outputTokens,
      ...params.metadata,
    },
  });

  trackTrialUsage(params.workspaceId, total, params.source);
}
