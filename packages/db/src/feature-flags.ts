import { createHash } from 'crypto';
import type {
  FeatureFlag,
  FlagCondition,
  FlagEvaluationContext,
  FlagEvaluationResult,
  TargetingRule,
} from '@repo/types';
import { createServiceClient } from './service';

// ── In-memory cache (30s TTL) ──

interface CacheEntry {
  flags: Map<string, FeatureFlag>;
  timestamp: number;
}

const CACHE_TTL_MS = 30_000;
let cache: CacheEntry | null = null;

async function loadFlags(): Promise<Map<string, FeatureFlag>> {
  const now = Date.now();
  if (cache && now - cache.timestamp < CACHE_TTL_MS) {
    return cache.flags;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.from('feature_flags').select('*').eq('enabled', true);

  if (error) {
    console.warn(
      `[feature-flags] DB load failed: ${error.message} — using ${cache ? 'stale cache' : 'empty flags (all off)'}`,
    );
    // Return stale cache if available (last-known-good). If no cache, fail closed (all flags off).
    if (cache) return cache.flags;
    return new Map();
  }

  const flags = new Map<string, FeatureFlag>();
  for (const row of data ?? []) {
    flags.set(row.key, row as FeatureFlag);
  }

  cache = { flags, timestamp: now };
  return flags;
}

/** Clear the in-memory flag cache (useful after mutations in admin) */
export function clearFlagCache(): void {
  cache = null;
}

// ── Evaluation Engine ──

export function evaluateFlag(
  flag: FeatureFlag,
  context: FlagEvaluationContext,
): FlagEvaluationResult {
  if (!flag.enabled) {
    return flag.flag_type === 'boolean' ? false : null;
  }

  // Remote config: always return payload when enabled
  if (flag.flag_type === 'remote_config') {
    return flag.payload ?? null;
  }

  // Evaluate rules top-to-bottom, first match wins
  for (const rule of flag.rules) {
    if (matchesConditions(rule.conditions, context)) {
      if (isInRollout(rule.rollout_percentage, context.userId, flag.key)) {
        if (flag.flag_type === 'boolean') return true;
        return rule.variant ?? flag.default_variant ?? null;
      }
    }
  }

  // No rules matched — return default
  if (flag.flag_type === 'boolean') {
    // If there are no rules but the flag is enabled, it's on for everyone
    return flag.rules.length === 0 ? true : false;
  }
  return flag.default_variant ?? null;
}

export function matchesConditions(
  conditions: FlagCondition[],
  context: FlagEvaluationContext,
): boolean {
  return conditions.every((c) => evaluateCondition(c, context));
}

export function evaluateCondition(
  condition: FlagCondition,
  context: FlagEvaluationContext,
): boolean {
  const { property, operator, value } = condition;
  const actual = context[property];

  // Presence checks
  if (operator === 'is_set') return actual !== undefined && actual !== null;
  if (operator === 'is_not_set') return actual === undefined || actual === null;

  // Boolean checks
  if (operator === 'is_true') return actual === true || actual === 'true';
  if (operator === 'is_false') return actual === false || actual === 'false';

  // If property not present, condition fails
  if (actual === undefined || actual === null) return false;

  const actualStr = String(actual);
  const valueStr = String(value);

  switch (operator) {
    case 'equals':
      return actualStr === valueStr;
    case 'not_equals':
      return actualStr !== valueStr;
    case 'contains':
      return actualStr.includes(valueStr);
    case 'not_contains':
      return !actualStr.includes(valueStr);
    case 'starts_with':
      return actualStr.startsWith(valueStr);
    case 'ends_with':
      return actualStr.endsWith(valueStr);
    case 'in':
      return Array.isArray(value) ? value.map(String).includes(actualStr) : false;
    case 'not_in':
      return Array.isArray(value) ? !value.map(String).includes(actualStr) : true;
    case 'gt':
      return Number(actual) > Number(value);
    case 'gte':
      return Number(actual) >= Number(value);
    case 'lt':
      return Number(actual) < Number(value);
    case 'lte':
      return Number(actual) <= Number(value);
    default:
      return false;
  }
}

export function isInRollout(percentage: number, entityId: string, flagKey: string): boolean {
  if (percentage >= 100) return true;
  if (percentage <= 0) return false;

  // Deterministic hash: same user+flag always gets same bucket
  const hash = createHash('md5').update(`${entityId}:${flagKey}`).digest();
  const bucket = (hash.readUInt32BE(0) % 100) + 1; // 1-100
  return bucket <= percentage;
}

// ── Public API ──

/** Evaluate a single flag by key */
export async function getFlag(
  key: string,
  context: FlagEvaluationContext,
): Promise<FlagEvaluationResult> {
  const flags = await loadFlags();
  const flag = flags.get(key);
  if (!flag) return false;
  return evaluateFlag(flag, context);
}

/** Check if a boolean feature flag is enabled */
export async function isFeatureEnabled(
  key: string,
  context: FlagEvaluationContext,
): Promise<boolean> {
  const result = await getFlag(key, context);
  return result === true;
}

/** Evaluate all enabled flags for a context (for bulk API response) */
export async function evaluateAllFlags(
  context: FlagEvaluationContext,
): Promise<Record<string, boolean | string>> {
  const flags = await loadFlags();
  const results: Record<string, boolean | string> = {};

  for (const [key, flag] of flags) {
    const result = evaluateFlag(flag, context);
    if (typeof result === 'boolean' || typeof result === 'string') {
      results[key] = result;
    }
  }

  return results;
}

// ── Stale Flag Detection ──

export interface StaleFlag {
  key: string;
  name: string;
  reason: 'no_rules_disabled' | 'no_audit_activity' | 'old_enabled_no_rules';
  lastUpdated: string;
  daysSinceUpdate: number;
}

/**
 * Detect potentially stale feature flags.
 *
 * A flag is considered stale if:
 * 1. It's disabled with no targeting rules (likely a leftover)
 * 2. It hasn't been modified in 30+ days with no audit activity
 * 3. It's enabled with no targeting rules and was created 60+ days ago
 */
export async function detectStaleFlags(staleDays = 30): Promise<StaleFlag[]> {
  const supabase = createServiceClient();
  const { data: allFlags, error } = await supabase
    .from('feature_flags')
    .select('id, key, name, enabled, rules, updated_at, created_at');

  if (error || !allFlags) return [];

  const now = Date.now();
  const stale: StaleFlag[] = [];

  for (const flag of allFlags) {
    const updatedMs = new Date(flag.updated_at).getTime();
    const daysSince = Math.floor((now - updatedMs) / (1000 * 60 * 60 * 24));
    const rules = Array.isArray(flag.rules) ? flag.rules : [];

    // Disabled flag with no rules — likely a leftover
    if (!flag.enabled && rules.length === 0 && daysSince >= 7) {
      stale.push({
        key: flag.key,
        name: flag.name,
        reason: 'no_rules_disabled',
        lastUpdated: flag.updated_at,
        daysSinceUpdate: daysSince,
      });
      continue;
    }

    // Not updated in staleDays — check for audit activity
    if (daysSince >= staleDays) {
      const { count } = await supabase
        .from('feature_flag_audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('flag_id', flag.id)
        .gte('created_at', new Date(now - staleDays * 24 * 60 * 60 * 1000).toISOString());

      if ((count ?? 0) === 0) {
        stale.push({
          key: flag.key,
          name: flag.name,
          reason: 'no_audit_activity',
          lastUpdated: flag.updated_at,
          daysSinceUpdate: daysSince,
        });
        continue;
      }
    }

    // Enabled, no rules, old — probably should be permanent or cleaned up
    const createdMs = new Date(flag.created_at).getTime();
    const daysSinceCreated = Math.floor((now - createdMs) / (1000 * 60 * 60 * 24));
    if (flag.enabled && rules.length === 0 && daysSinceCreated >= 60) {
      stale.push({
        key: flag.key,
        name: flag.name,
        reason: 'old_enabled_no_rules',
        lastUpdated: flag.updated_at,
        daysSinceUpdate: daysSince,
      });
    }
  }

  return stale;
}

/**
 * Archive (soft-delete) stale flags by disabling them and adding a tag.
 * Returns the number of flags archived.
 */
export async function archiveStaleFlags(flagKeys: string[]): Promise<number> {
  if (flagKeys.length === 0) return 0;

  const supabase = createServiceClient();
  let archived = 0;

  for (const key of flagKeys) {
    const { data: flag } = await supabase
      .from('feature_flags')
      .select('id, tags')
      .eq('key', key)
      .maybeSingle();

    if (!flag) continue;

    const tags = Array.isArray(flag.tags) ? flag.tags : [];
    if (!tags.includes('archived')) tags.push('archived');

    const { error } = await supabase
      .from('feature_flags')
      .update({ enabled: false, tags })
      .eq('id', flag.id);

    if (!error) archived++;
  }

  clearFlagCache();
  return archived;
}
