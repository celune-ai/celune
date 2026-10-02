/**
 * Plan Enforcement — Paywall
 * ─────────────────────────────────────────────────────────────────────────────
 * Celune Cloud is paid from day one; there is no trial and no free tier.
 *
 * 1. `resolveWorkspacePlan()` resolves a workspace to `cloud`, `enterprise`,
 *    `platform_owner`, or `unpaid` (see `decidePlan()`). The org owner is the
 *    billing entity: their subscription or access code covers the org.
 *
 * 2. `unpaid` blocks every workspace-scoped API call with 402
 *    `subscription_required` (`requireActivePlan()`, run by `withApiSecurity`),
 *    and the client `PaywallGate` sends the user to `/subscribe`.
 *
 * 3. Cloud and Enterprise have no numeric limits. `enforcePlanLimit()` still
 *    compares usage against `PlanLimits`, so a limit set later takes effect
 *    without new code. Data is never deleted when a subscription lapses.
 *
 * 4. The community edition has no billing: every workspace resolves to `cloud`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { PLAN_TIERS, normalizePlan } from '@repo/types';
import type { Plan, PlanLimits } from '@repo/types';
import { resolveHostConfig } from '@celuneai/core/config';
import { getPlanLimits } from '@/lib/stripe';

interface EnforcementContext {
  workspaceId: string;
  userId?: string;
}

export interface UsageCounts {
  tasks_this_month: number;
  tts_minutes_this_month: number;
  api_calls_this_month: number;
  llm_cost_this_month: number;
  agent_count: number;
}

/**
 * Check if a user is the platform owner (app creator — unlimited Enterprise).
 * Uses app_metadata only — it is server-writable and not user-controllable.
 * NEVER use user_metadata for privilege checks (users can self-set it).
 */
async function checkIsPlatformOwner(userId: string): Promise<boolean> {
  if (!userId) return false;
  // Service client: check platform owner flag in app_metadata. Accesses: auth.users.
  const supabase = createServiceClient();
  const { data } = await supabase.auth.admin.getUserById(userId);
  return data?.user?.app_metadata?.is_platform_owner === true;
}

/** Re-export platform owner check for use by the BYOK gate and other utilities. */
export { checkIsPlatformOwner as isPlatformOwner };

export interface ResolvedPlan {
  plan: Plan;
  limits: PlanLimits;
  isPlatformOwner: boolean;
  /** The org's Cloud payment failed; access continues while Stripe retries. */
  pastDue: boolean;
}

export interface PlanInputs {
  /** The requester or the org owner is the platform owner. */
  platformOwner: boolean;
  /** Plan on an active access code redeemed by the org owner, if any. */
  accessCodePlan: string | null;
  /** The org owner's subscription row, if any. */
  subscription: {
    plan: string | null;
    status: string | null;
    stripe_subscription_id: string | null;
  } | null;
}

/**
 * Subscription statuses that keep access. past_due (the webhook also stores Stripe's
 * incomplete as past_due) keeps access while Stripe retries the payment, with a billing
 * warning; canceled (Stripe's canceled, unpaid, and incomplete_expired) does not.
 */
export function hasAccess(status: string | null): boolean {
  return status === 'active' || status === 'trialing' || status === 'past_due';
}

/**
 * The paywall decision, from the org owner's billing state. An org gets access
 * through an Enterprise plan set by hand (ranked first), an access code the
 * owner redeemed, an active, trialing, or past_due Cloud subscription, or the
 * platform owner. Everything else is `unpaid`.
 */
export function decidePlan({ platformOwner, accessCodePlan, subscription }: PlanInputs): Plan {
  // Enterprise set by hand ranks first, so no Cloud code or subscription can shadow it.
  if (
    subscription &&
    normalizePlan(subscription.plan) === 'enterprise' &&
    subscription.status !== 'canceled'
  ) {
    return 'enterprise';
  }
  if (accessCodePlan !== null) {
    return normalizePlan(accessCodePlan) === 'enterprise' ? 'enterprise' : 'cloud';
  }
  // Rows without a Stripe subscription are old free-tier rows; they grant nothing.
  if (subscription && hasAccess(subscription.status) && subscription.stripe_subscription_id) {
    return 'cloud';
  }
  if (platformOwner) return 'platform_owner';
  return 'unpaid';
}

type ServiceClient = ReturnType<typeof createServiceClient>;

async function activeAccessCodePlan(supabase: ServiceClient, userId: string) {
  const { data } = await supabase
    .from('access_codes')
    .select('id, plan')
    .eq('redeemed_by', userId)
    .is('revoked_at', null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .limit(1)
    .maybeSingle();
  return data ? ((data.plan as string | null) ?? 'cloud') : null;
}

/**
 * Resolve the effective plan for a workspace.
 * Traverses workspace → org → owner → access code or subscription.
 *
 * Shared utility — used by plan enforcement, readiness API, and usage API.
 */
export async function resolveWorkspacePlan(
  workspaceId: string,
  userId?: string,
): Promise<ResolvedPlan> {
  // userId only marks the platform owner; plan state comes from the org owner.
  let isPlatformOwnerFlag = userId ? await checkIsPlatformOwner(userId) : false;

  // Community edition has no billing: no paywall, no subscriptions, no limits.
  if (resolveHostConfig(process.env).edition === 'community') {
    return {
      plan: 'cloud',
      limits: PLAN_TIERS.cloud,
      isPlatformOwner: isPlatformOwnerFlag,
      pastDue: false,
    };
  }

  const supabase = createServiceClient();
  let accessCodePlan: string | null = null;
  let subscription: PlanInputs['subscription'] = null;

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('org_id')
    .eq('id', workspaceId)
    .single();

  // The org owner is the billing entity. Access codes are scoped to them too: a code
  // covers the orgs its redeemer owns, so a member's code never unlocks another org.
  const { data: org } = workspace?.org_id
    ? await supabase.from('organizations').select('owner_id').eq('id', workspace.org_id).single()
    : { data: null };
  const ownerId = org?.owner_id as string | undefined;

  if (ownerId) {
    if (ownerId !== userId && (await checkIsPlatformOwner(ownerId))) isPlatformOwnerFlag = true;
    const [code, { data: sub }] = await Promise.all([
      activeAccessCodePlan(supabase, ownerId),
      supabase
        .from('subscriptions')
        .select('plan, status, stripe_subscription_id')
        .eq('user_id', ownerId)
        .maybeSingle(),
    ]);
    accessCodePlan = code;
    subscription = sub ?? null;
  }

  const plan = decidePlan({ platformOwner: isPlatformOwnerFlag, accessCodePlan, subscription });
  return {
    plan,
    limits: getPlanLimits(plan),
    isPlatformOwner: isPlatformOwnerFlag,
    pastDue: plan === 'cloud' && accessCodePlan === null && subscription?.status === 'past_due',
  };
}

/**
 * Get current month usage counts for a workspace.
 */
export async function getCurrentUsage(workspaceId: string): Promise<UsageCounts> {
  // Service client: aggregates usage across all users in a workspace for plan limit checks. Accesses: usage_events (via RPC), agent_configs.
  const supabase = createServiceClient();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const since = monthStart.toISOString();

  // Use aggregation to avoid Supabase's 1000-row default limit
  const { data: events } = await supabase.rpc('sum_usage_events', {
    p_workspace_id: workspaceId,
    p_since: since,
  });

  const counts: Record<string, number> = {};
  for (const e of (events ?? []) as { event_type: string; total: number }[]) {
    counts[e.event_type] = e.total;
  }

  // Count active AI agents (exclude soft-deleted and human entries)
  const { count: agentCount } = await supabase
    .from('agent_configs')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .eq('agent_type', 'ai');

  return {
    tasks_this_month: counts['task_executed'] ?? 0,
    tts_minutes_this_month: counts['tts_minutes'] ?? 0,
    api_calls_this_month: counts['api_call'] ?? 0,
    llm_cost_this_month: counts['llm_tokens'] ?? 0,
    agent_count: agentCount ?? 0,
  };
}

type LimitCheck = 'tasks' | 'tts' | 'api_calls' | 'agents' | 'llm_cost' | 'memories' | 'projects';

const LIMIT_MAP: Record<
  Exclude<LimitCheck, 'memories' | 'projects'>,
  { usageKey: keyof UsageCounts; limitKey: keyof PlanLimits; label: string }
> = {
  tasks: { usageKey: 'tasks_this_month', limitKey: 'max_tasks_per_month', label: 'task' },
  tts: {
    usageKey: 'tts_minutes_this_month',
    limitKey: 'max_tts_minutes_per_month',
    label: 'TTS minute',
  },
  api_calls: {
    usageKey: 'api_calls_this_month',
    limitKey: 'max_api_calls_per_month',
    label: 'API call',
  },
  agents: { usageKey: 'agent_count', limitKey: 'max_agents', label: 'agent' },
  llm_cost: {
    usageKey: 'llm_cost_this_month',
    limitKey: 'max_llm_cost_per_month',
    label: 'LLM cost',
  },
};

/**
 * Count active projects for a workspace.
 */
async function getProjectCount(workspaceId: string): Promise<number> {
  const supabase = createServiceClient();
  const { count } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .in('status', ['active', 'paused']);
  return count ?? 0;
}

/**
 * Count agent_memory rows for a workspace. Memory rows are stored directly
 * (not via usage_events), so we query agent_memory directly.
 */
async function getMemoryCount(workspaceId: string): Promise<number> {
  // Service client: count memories for limit check. Accesses: agent_memory.
  const supabase = createServiceClient();
  const { count } = await supabase
    .from('agent_memory')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);
  return count ?? 0;
}

/**
 * Check if a workspace has exceeded a specific plan limit.
 * Returns null if within limits, NextResponse 429 if exceeded.
 *
 * Usage:
 *   const blocked = await enforcePlanLimit({ workspaceId }, 'tasks');
 *   if (blocked) return blocked;
 */
export async function enforcePlanLimit(
  ctx: EnforcementContext,
  check: LimitCheck,
): Promise<NextResponse | null> {
  try {
    const { plan, limits } = await resolveWorkspacePlan(ctx.workspaceId, ctx.userId);

    // Hard gate: an unpaid org is blocked everywhere until it subscribes
    if (plan === 'unpaid') return subscriptionRequired();

    // Projects are counted directly, not via usage_events
    if (check === 'projects') {
      const maxLimit = limits.max_projects;
      if (maxLimit === null) return null;

      const current = await getProjectCount(ctx.workspaceId);
      if (current >= maxLimit) {
        return NextResponse.json(
          {
            error: 'plan_limit',
            limit: 'max_projects',
            current,
            max: maxLimit,
            plan,
            upgrade_url: '/settings?tab=billing',
          },
          { status: 403 },
        );
      }
      return null;
    }

    // Memories are counted directly from agent_memory, not via usage_events
    if (check === 'memories') {
      const maxLimit = limits.max_memories;
      // null = unlimited
      if (maxLimit === null) return null;

      const current = await getMemoryCount(ctx.workspaceId);
      if (current >= maxLimit) {
        return NextResponse.json(
          {
            error: 'plan_limit',
            limit: 'max_memories',
            current,
            max: maxLimit,
            plan,
            upgrade_url: '/settings?tab=billing',
          },
          { status: 403 },
        );
      }
      return null;
    }

    const mapping = LIMIT_MAP[check];
    const maxLimit = limits[mapping.limitKey] as number | null;

    // null = unlimited
    if (maxLimit === null) return null;

    const usage = await getCurrentUsage(ctx.workspaceId);
    const current = usage[mapping.usageKey];

    if (current >= maxLimit) {
      // For LLM and TTS limits, hint that BYOK can bypass the limit
      const byokEligible = check === 'llm_cost' || check === 'tts';
      return NextResponse.json(
        {
          error: 'plan_limit',
          limit: mapping.limitKey,
          current,
          max: maxLimit,
          plan,
          upgrade_url: '/settings?tab=billing',
          ...(byokEligible && {
            byok_hint: 'Bring your own API key to bypass this limit.',
            byok_url: '/settings?tab=integrations',
          }),
        },
        { status: 403 },
      );
    }

    return null;
  } catch (error) {
    // Fail open — don't block operations due to enforcement errors, but log for alerting
    console.error('[plan-enforcement] enforcePlanLimit failed, allowing request:', {
      workspaceId: ctx.workspaceId,
      check,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Get memory usage info for a workspace: current count and plan limit.
 * Returns { count, limit, plan } — limit is null for unlimited plans.
 */
export async function getMemoryUsage(
  workspaceId: string,
  userId?: string,
): Promise<{ count: number; limit: number | null; plan: string }> {
  const { plan, limits } = await resolveWorkspacePlan(workspaceId, userId);
  const count = await getMemoryCount(workspaceId);
  return { count, limit: limits.max_memories, plan };
}

const SUBSCRIPTION_REQUIRED_MESSAGE =
  'This organization needs a Celune Cloud subscription. Subscribe to continue.';

function subscriptionRequired(): NextResponse {
  return NextResponse.json(
    {
      error: 'subscription_required',
      message: SUBSCRIPTION_REQUIRED_MESSAGE,
      upgrade_url: '/subscribe',
    },
    { status: 402 },
  );
}

/**
 * Paywall for API routes.
 * Returns a 402 NextResponse if the workspace's org has no active plan, null otherwise.
 * Use this on both read AND write endpoints — `unpaid` blocks everything.
 *
 * Whitelisted routes should NOT call this:
 * - /api/billing/checkout, /api/billing/portal, /api/billing/subscription, /api/billing/webhook
 * - /api/workspaces/plan (needed by the subscribe page itself)
 *
 * Usage:
 *   const blocked = await requireActivePlan({ workspaceId, userId });
 *   if (blocked) return blocked;
 */
export async function requireActivePlan(ctx: EnforcementContext): Promise<NextResponse | null> {
  try {
    const { plan } = await resolveWorkspacePlan(ctx.workspaceId, ctx.userId);
    return plan === 'unpaid' ? subscriptionRequired() : null;
  } catch (error) {
    // Fail open — don't block operations due to enforcement errors
    console.error('[plan-enforcement] requireActivePlan failed, allowing request:', {
      workspaceId: ctx.workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Quick check: is a feature available on the workspace's plan?
 */
export async function isFeatureAvailable(
  workspaceId: string,
  feature: string,
  userId?: string,
): Promise<boolean> {
  try {
    const { limits } = await resolveWorkspacePlan(workspaceId, userId);
    return limits.features.includes(feature);
  } catch (error) {
    console.error('[plan-enforcement] isFeatureAvailable failed, allowing feature:', {
      workspaceId,
      feature,
      error: error instanceof Error ? error.message : String(error),
    });
    return true; // Fail open
  }
}
