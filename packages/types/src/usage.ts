// ── Usage Metering Types ──────────────────────────────────────────────────────

export type UsageEventType =
  | 'llm_tokens'
  | 'tts_minutes'
  | 'api_call'
  | 'task_executed'
  | 'storage_bytes'
  | 'slack_ai_message';

export type UsageUnit = 'tokens' | 'minutes' | 'bytes' | 'count' | 'usd';

export type UsageMetric =
  'llm_tokens' | 'llm_cost_usd' | 'tts_minutes' | 'api_calls' | 'tasks_executed' | 'storage_bytes';

export interface UsageEvent {
  id: string;
  workspace_id: string;
  org_id: string | null;
  user_id: string | null;
  event_type: UsageEventType;
  quantity: number;
  unit: UsageUnit;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type UsageEventInsert = Omit<UsageEvent, 'id' | 'created_at'> & {
  created_at?: string;
};

/** Plan tier limits — used by plan enforcement middleware */
export interface PlanLimits {
  max_agents: number | null;
  max_workspaces: number | null;
  max_projects: number | null;
  max_tasks_per_month: number | null;
  max_tts_minutes_per_month: number | null;
  max_api_calls_per_month: number | null;
  max_llm_cost_per_month: number | null;
  max_storage_bytes: number | null;
  max_memories: number | null;
  max_slack_ai_messages_per_month: number | null;
  features: string[];
}

/**
 * Predefined plan tiers.
 *
 * UI consumers (update this list when adding new references):
 * - apps/platform/src/app/api/workspaces/plan/route.ts   — API: resolves workspace plan + limits
 * - apps/platform/src/hooks/use-plan.ts                  — Client hook: current plan limits
 * - apps/platform/src/lib/plan-enforcement.ts            — Server middleware: paywall + plan limits
 * - apps/platform/src/components/settings/settings-provider-keys-tab.tsx — BYOK feature gate
 * - apps/platform/src/hooks/use-feature-gate.ts          — Client hook: single-feature gate check
 * - apps/platform/src/components/feature-gate.tsx         — Wrapper: hide/disable by plan feature
 * - apps/platform/src/components/upgrade-prompt.tsx       — Inline upgrade CTA badge
 */
/**
 * Pricing: Celune Cloud at $25 per seat per month, or $20 per seat per month billed
 * annually. A seat is an active human org member. Enterprise is contact sales.
 * Self-hosting the community edition is the free path.
 *
 * Cloud and Enterprise have no numeric limits (fair use) and include BYOK;
 * Celune never bills model usage.
 */
const ALL_LIMITS_UNSET = {
  max_agents: null,
  max_workspaces: null,
  max_projects: null,
  max_tasks_per_month: null,
  max_tts_minutes_per_month: null,
  max_api_calls_per_month: null,
  max_llm_cost_per_month: null,
  max_storage_bytes: null,
  max_memories: null,
  max_slack_ai_messages_per_month: null,
} as const;

const CLOUD_FEATURES = [
  'basic_dashboard',
  'task_management',
  'integrations',
  'byok',
  'api_access',
  'afk_modes',
  'voice',
  'analytics',
  'agent_personalities',
  'webhooks',
  'teammates',
  'audit_log',
  'brain_sharing',
  'all_skills',
  'roles_management',
  'per_seat_billing',
  'slack_ai',
];

const ENTERPRISE_FEATURES = [
  ...CLOUD_FEATURES.filter((f) => f !== 'per_seat_billing'),
  'custom_integrations',
  'dedicated_support',
  'governance_tools',
];

const BASE_PLAN_TIERS = {
  cloud: { ...ALL_LIMITS_UNSET, features: CLOUD_FEATURES },
  enterprise: { ...ALL_LIMITS_UNSET, features: ENTERPRISE_FEATURES },
  platform_owner: { ...ALL_LIMITS_UNSET, features: ENTERPRISE_FEATURES },
} satisfies Record<string, PlanLimits>;

export const PLAN_TIERS: Record<string, PlanLimits> = {
  ...BASE_PLAN_TIERS,
  /** Legacy plan names read from old rows or metadata resolve to Cloud. */
  builder: BASE_PLAN_TIERS.cloud,
  pro: BASE_PLAN_TIERS.cloud,
  unlimited: BASE_PLAN_TIERS.cloud,
  team: BASE_PLAN_TIERS.cloud,
  build: BASE_PLAN_TIERS.cloud,
  free: BASE_PLAN_TIERS.cloud,
};
