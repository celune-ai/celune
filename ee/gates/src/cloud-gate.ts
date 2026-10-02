import type { Gate, GateContext, GateFeature, GateFeaturePolicy, GateResult } from '@celuneai/core';
import { checkSuspension, type WorkspaceMetadataReader } from './suspension.ts';

export type PlanLimitCheck = 'tasks' | 'projects' | 'api_calls';

export interface PlanDenial {
  status: 402 | 403;
  body: Record<string, unknown>;
}

export interface CloudGateDeps {
  /** Resolves the workspace plan and returns the denial payload, or null when within limits. */
  planLimit(
    ctx: { workspaceId: string; userId?: string },
    check: PlanLimitCheck,
  ): Promise<PlanDenial | null>;
  workspaceMetadata: WorkspaceMetadataReader;
  /**
   * The paywall: returns the denial payload when the workspace's org has no active
   * plan, null otherwise. Checked for every feature, so an unpaid org cannot read,
   * write, run agents, queue jobs, or use the host model key.
   */
  paywall?(ctx: { workspaceId: string; userId?: string }): Promise<PlanDenial | null>;
  /** Trial token budget for a workspace; null when the workspace is unknown. Only read for provider.fallback_key. */
  trialBudget?(workspaceId: string): Promise<{ budget: number; used: number } | null>;
}

export const PLAN_LIMITS: Partial<Record<GateFeature, PlanLimitCheck>> = {
  'task.create': 'tasks',
  'project.create': 'projects',
  'api_key.create': 'api_calls',
};

function denial(denied: PlanDenial, fallbackReason: string): GateResult {
  return {
    allowed: false,
    reason: typeof denied.body.error === 'string' ? denied.body.error : fallbackReason,
    status: denied.status,
    upgradeUrl: typeof denied.body.upgrade_url === 'string' ? denied.body.upgrade_url : undefined,
    details: denied.body,
  };
}

/** Celune Cloud gate: suspension first, then the paywall, then the plan limit mapped to the feature. */
export class CloudGate implements Gate {
  private readonly deps: CloudGateDeps;

  constructor(deps: CloudGateDeps) {
    this.deps = deps;
  }

  async check(feature: GateFeature, ctx: GateContext): Promise<GateResult> {
    const suspension = await checkSuspension(this.deps.workspaceMetadata, ctx.scope.workspaceId);
    if (!suspension.allowed) return suspension;

    const planCtx = { workspaceId: ctx.scope.workspaceId, userId: ctx.userId ?? undefined };
    const unpaid = this.deps.paywall ? await this.deps.paywall(planCtx) : null;
    if (unpaid) return denial(unpaid, 'subscription_required');

    if (feature === 'provider.fallback_key') return this.checkTrialBudget(ctx.scope.workspaceId);

    const limit = PLAN_LIMITS[feature];
    if (!limit) return { allowed: true };
    const denied = await this.deps.planLimit(planCtx, limit);
    return denied ? denial(denied, 'plan_limit') : { allowed: true };
  }

  describe(feature: GateFeature): GateFeaturePolicy {
    if (feature === 'provider.fallback_key') return this.deps.trialBudget ? 'metered' : 'open';
    return PLAN_LIMITS[feature] || this.deps.paywall ? 'plan_limited' : 'open';
  }

  private async checkTrialBudget(workspaceId: string): Promise<GateResult> {
    if (!this.deps.trialBudget) return { allowed: true };
    const trial = await this.deps.trialBudget(workspaceId);
    if (!trial || trial.used < trial.budget) return { allowed: true };
    return {
      allowed: false,
      reason: 'trial_exhausted',
      status: 402,
      details: { error: 'trial_exhausted', budget: trial.budget, used: trial.used },
    };
  }
}
