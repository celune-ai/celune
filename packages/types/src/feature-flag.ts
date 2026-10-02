// ── Condition Operators ──

export const CONDITION_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'in',
  'not_in',
  'gt',
  'gte',
  'lt',
  'lte',
  'is_set',
  'is_not_set',
  'is_true',
  'is_false',
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

// ── Flag Types ──

export const FLAG_TYPES = ['boolean', 'multivariate', 'remote_config'] as const;
export type FlagType = (typeof FLAG_TYPES)[number];

// ── Condition ──

export interface FlagCondition {
  property: string;
  operator: ConditionOperator;
  value: string | string[] | number | boolean;
}

// ── Targeting Rule ──

export interface TargetingRule {
  id: string;
  conditions: FlagCondition[];
  rollout_percentage: number;
  variant?: string;
}

// ── Variant (for multivariate flags) ──

export interface FlagVariant {
  key: string;
  value: string | number | boolean | Record<string, unknown>;
  weight: number;
}

// ── Feature Flag ──

export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description: string | null;
  flag_type: FlagType;
  enabled: boolean;
  variants: FlagVariant[];
  payload: Record<string, unknown> | null;
  rules: TargetingRule[];
  default_variant: string | null;
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── Audit Log ──

export const AUDIT_ACTIONS = ['created', 'updated', 'toggled', 'deleted'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface FeatureFlagAuditEntry {
  id: string;
  flag_id: string;
  action: AuditAction;
  changes: Record<string, unknown> | null;
  performed_by: string | null;
  created_at: string;
}

// ── Evaluation Context ──

export interface FlagEvaluationContext {
  userId: string;
  email?: string;
  plan?: string;
  [key: string]: string | number | boolean | undefined;
}

// ── Evaluation Result ──

export type FlagEvaluationResult = boolean | string | Record<string, unknown> | null;

// ── API Response Types ──

export interface FeatureFlagListResponse {
  flags: FeatureFlag[];
  total: number;
}

export interface EvaluatedFlags {
  [flagKey: string]: boolean | string;
}
