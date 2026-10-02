import type { WorkspaceScope } from './scope.ts';

export type GateFeature =
  /** Any use of a workspace over the API or MCP, reads included. */
  | 'workspace.access'
  | 'task.create'
  | 'project.create'
  | 'job.enqueue'
  | 'agent.run'
  | 'member.invite'
  | 'api_key.create'
  /** Use of a host-provided provider key when the workspace has no BYOK key. */
  | 'provider.fallback_key';

/** Every feature a gate can be asked about, in display order. */
export const GATE_FEATURES: readonly GateFeature[] = [
  'workspace.access',
  'task.create',
  'project.create',
  'job.enqueue',
  'agent.run',
  'member.invite',
  'api_key.create',
  'provider.fallback_key',
];

export const GATE_FEATURE_LABELS: Record<GateFeature, string> = {
  'workspace.access': 'Use the workspace over the API',
  'task.create': 'Create tasks',
  'project.create': 'Create projects',
  'job.enqueue': 'Queue background jobs',
  'agent.run': 'Run agents',
  'member.invite': 'Invite members',
  'api_key.create': 'Create API keys',
  'provider.fallback_key': 'Use the host model key when the workspace has none',
};

/**
 * How a gate treats a feature, independent of any one workspace:
 * `open` is never checked, `plan_limited` is capped by the workspace plan,
 * `metered` draws from a usage budget. Hosts may add account-level checks
 * (such as suspension) on top of any policy.
 */
export type GateFeaturePolicy = 'open' | 'plan_limited' | 'metered';

export interface GateContext {
  scope: WorkspaceScope;
  /** Authenticated user making the call, when known. */
  userId?: string | null;
}

export type GateResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: string;
      /** HTTP status a transport should answer with; 402, 403, or 503 when the check itself failed. */
      status?: 402 | 403 | 503;
      upgradeUrl?: string;
      /** Transport-facing payload; kept so hosted responses do not change shape. */
      details?: Record<string, unknown>;
    };

export interface Gate {
  check(feature: GateFeature, ctx: GateContext): Promise<GateResult>;
  /** Static policy for a feature; gates without it are treated as `open`. */
  describe?(feature: GateFeature): GateFeaturePolicy;
}

export function describeGate(
  gate: Gate,
): Array<{ feature: GateFeature; policy: GateFeaturePolicy }> {
  return GATE_FEATURES.map((feature) => ({ feature, policy: gate.describe?.(feature) ?? 'open' }));
}

/** Open-source default: every feature is allowed. */
export class NoopGate implements Gate {
  async check(_feature: GateFeature, _ctx: GateContext): Promise<GateResult> {
    return { allowed: true };
  }

  describe(_feature: GateFeature): GateFeaturePolicy {
    return 'open';
  }
}
