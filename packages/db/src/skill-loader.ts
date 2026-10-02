/**
 * Progressive Disclosure Skill Loader
 *
 * Loads skills progressively based on workspace plan. Maps billing plan
 * names to internal BrainTier for filtering brain_manifest entries.
 *
 * - Builder (free):     16 skills, 2 agents — essential tier only
 * - Pro ($19/mo):       30 skills, 5 agents — essential + standard tiers
 * - Unlimited ($49/mo): All skills, all agents — all tiers
 *
 * The loader filters brain_manifest entries and returns only what the
 * workspace is entitled to load, sorted by relevance.
 */

import { createServiceClient } from './service';
import type {
  BrainManifest,
  BrainTier,
  BrainCategory,
  SkillLoadTier,
  SkillPackMinPlan,
} from '@repo/types';

// ---------------------------------------------------------------------------
// Plan normalization
// ---------------------------------------------------------------------------
// Two tier vocabularies exist side by side:
//
//   brain_manifest.tier  → BrainTier          ('essential' | 'standard' | 'premium')
//   skill_packs.min_tier → SkillPackMinPlan   ('builder'   | 'pro'      | 'unlimited')
//
// Billing plans arrive as 'cloud', 'enterprise', or 'platform_owner', and old
// rows can still carry 'builder', 'pro', 'unlimited', 'build', 'free', or
// 'team'. Every billing plan loads the full skill catalog; only the brain tier
// names ('essential', 'standard') select a smaller set.

/** Canonical content vocabulary for the loaders below. */
type BillingPlan = 'builder' | 'pro' | 'unlimited';

/** Normalize a billing plan or brain tier name to the content vocabulary. */
function normalizePlan(raw: string): BillingPlan {
  switch (raw) {
    case 'essential':
      return 'builder';
    case 'standard':
      return 'pro';
    default:
      return 'unlimited';
  }
}

// ---------------------------------------------------------------------------
// Plan → BrainTier (for brain_manifest filtering)
// ---------------------------------------------------------------------------

const BILLING_TO_BRAIN_TIER: Record<BillingPlan, BrainTier> = {
  builder: 'essential',
  pro: 'standard',
  unlimited: 'premium',
};

/** Resolve a billing plan name (or legacy alias) to BrainTier. */
function resolveTier(planOrTier: string): BrainTier {
  return BILLING_TO_BRAIN_TIER[normalizePlan(planOrTier)];
}

// ---------------------------------------------------------------------------
// Plan → SkillPackMinPlan[] (for skill_packs filtering)
// ---------------------------------------------------------------------------

const BILLING_TO_PACK_TIERS: Record<BillingPlan, SkillPackMinPlan[]> = {
  builder: ['builder'],
  pro: ['builder', 'pro'],
  unlimited: ['builder', 'pro', 'unlimited'],
};

// ---------------------------------------------------------------------------
// Tier limits
// ---------------------------------------------------------------------------

const TIER_LIMITS: Record<BrainTier, SkillLoadTier> = {
  essential: { tier: 'essential', max_skills: 16, max_agents: 2 },
  standard: { tier: 'standard', max_skills: 30, max_agents: 5 },
  premium: { tier: 'premium', max_skills: 999, max_agents: 999 },
};

/** Tiers included at each level */
const TIER_HIERARCHY: Record<BrainTier, BrainTier[]> = {
  essential: ['essential'],
  standard: ['essential', 'standard'],
  premium: ['essential', 'standard', 'premium'],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SkillLoadResult {
  skills: BrainManifest[];
  tier: BrainTier;
  limits: SkillLoadTier;
  counts: {
    total: number;
    enabled: number;
    skills: number;
    agents: number;
    hooks: number;
  };
  at_skill_limit: boolean;
  at_agent_limit: boolean;
}

/**
 * Load skills for a workspace with progressive disclosure.
 *
 * @param workspaceId - The workspace to load skills for
 * @param plan - The workspace's billing plan name (e.g. 'cloud', 'enterprise')
 *               or internal tier name for backwards compatibility
 * @param options - Optional filters (category, enabled_only)
 */
export async function loadSkillsForWorkspace(
  workspaceId: string,
  plan: string = 'cloud',
  options: {
    category?: BrainCategory;
    enabledOnly?: boolean;
  } = {},
): Promise<SkillLoadResult> {
  const tier = resolveTier(plan);
  const limits = TIER_LIMITS[tier];
  const allowedTiers = TIER_HIERARCHY[tier];

  // Service client: reads brain_manifest for progressive loading. Accesses: brain_manifest.
  const supabase = createServiceClient();

  let query = supabase
    .from('brain_manifest')
    .select('*')
    .eq('workspace_id', workspaceId)
    .in('tier', allowedTiers)
    .order('category')
    .order('path');

  if (options.category) {
    query = query.eq('category', options.category);
  }
  if (options.enabledOnly !== false) {
    query = query.eq('is_enabled', true);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[skill-loader] Query error:', error);
    return {
      skills: [],
      tier,
      limits,
      counts: { total: 0, enabled: 0, skills: 0, agents: 0, hooks: 0 },
      at_skill_limit: false,
      at_agent_limit: false,
    };
  }

  const allEntries = (data ?? []) as BrainManifest[];

  // Count by category
  const skillCount = allEntries.filter((e) => e.category === 'skill').length;
  const agentCount = allEntries.filter((e) => e.category === 'agent').length;
  const hookCount = allEntries.filter((e) => e.category === 'hook').length;
  const enabledCount = allEntries.filter((e) => e.is_enabled).length;

  // Apply limits: skills and agents have hard caps per tier
  let filteredEntries = allEntries;

  if (skillCount > limits.max_skills) {
    // Keep only up to max_skills, preferring essential tier and core skills
    const skills = allEntries.filter((e) => e.category === 'skill');
    const nonSkills = allEntries.filter((e) => e.category !== 'skill');

    const prioritizedSkills = skills.sort((a, b) => {
      // Essential before standard before premium
      const tierOrder = { essential: 0, standard: 1, premium: 2 };
      const tierDiff = tierOrder[a.tier] - tierOrder[b.tier];
      if (tierDiff !== 0) return tierDiff;
      // Core before non-core
      if (a.is_core !== b.is_core) return a.is_core ? -1 : 1;
      return 0;
    });

    filteredEntries = [...nonSkills, ...prioritizedSkills.slice(0, limits.max_skills)];
  }

  if (agentCount > limits.max_agents) {
    const agents = filteredEntries.filter((e) => e.category === 'agent');
    const nonAgents = filteredEntries.filter((e) => e.category !== 'agent');

    const prioritizedAgents = agents.sort((a, b) => {
      const tierOrder = { essential: 0, standard: 1, premium: 2 };
      return tierOrder[a.tier] - tierOrder[b.tier];
    });

    filteredEntries = [...nonAgents, ...prioritizedAgents.slice(0, limits.max_agents)];
  }

  return {
    skills: filteredEntries,
    tier,
    limits,
    counts: {
      total: allEntries.length,
      enabled: enabledCount,
      skills: Math.min(skillCount, limits.max_skills),
      agents: Math.min(agentCount, limits.max_agents),
      hooks: hookCount,
    },
    at_skill_limit: skillCount >= limits.max_skills,
    at_agent_limit: agentCount >= limits.max_agents,
  };
}

/**
 * Get the tier limits for a given plan.
 */
export function getTierLimits(plan: string): SkillLoadTier {
  return TIER_LIMITS[resolveTier(plan)];
}

/**
 * Seed default skill packs for a workspace during onboarding.
 *
 * Finds packs matching the team's category (via team_type_affinity)
 * and the workspace's plan tier, then records installs. Does NOT
 * insert brain_manifest entries — that happens when the pack is
 * actually loaded via the /api/skill-packs/[slug]/install route.
 *
 * @param workspaceId - Workspace to seed
 * @param plan - Billing plan name (e.g. 'cloud', 'enterprise')
 * @param userId - User performing the install
 * @param teamCategory - Team template category (e.g. 'web-app', 'ai-ml', 'fullstack')
 * @returns Number of packs auto-installed
 */
/** Max affinity score for auto-install (1 = primary, 2 = secondary) */
const PACK_AFFINITY_THRESHOLD = 2;

export async function seedDefaultSkillPacks(
  workspaceId: string,
  plan: string = 'cloud',
  userId: string,
  teamCategory?: string,
): Promise<{ installed: number; packSlugs: string[] }> {
  // Validate inputs
  if (!workspaceId || !userId) {
    console.error('[skill-loader] seedDefaultSkillPacks: missing workspaceId or userId');
    return { installed: 0, packSlugs: [] };
  }

  const supabase = createServiceClient();

  // Use shared normalization + tier mapping
  const allowedMinTiers = BILLING_TO_PACK_TIERS[normalizePlan(plan)];

  // Fetch published packs the workspace is entitled to
  const { data: packs, error } = await supabase
    .from('skill_packs')
    .select('id, slug, name, version, team_type_affinity, min_tier')
    .eq('is_published', true)
    .in('min_tier', allowedMinTiers);

  if (error || !packs?.length) {
    console.error('[skill-loader] Seed packs query error:', error?.message ?? 'no packs found');
    return { installed: 0, packSlugs: [] };
  }

  // Sort packs by team affinity (lower number = higher priority)
  const sortedPacks = packs.sort((a, b) => {
    const aAffinity = teamCategory
      ? ((a.team_type_affinity as Record<string, number>)?.[teamCategory] ?? 99)
      : 99;
    const bAffinity = teamCategory
      ? ((b.team_type_affinity as Record<string, number>)?.[teamCategory] ?? 99)
      : 99;
    return aAffinity - bAffinity;
  });

  // Install top packs (priority 1 and 2 for the team type)
  const packsToInstall = teamCategory
    ? sortedPacks.filter((p) => {
        const affinity = (p.team_type_affinity as Record<string, number>)?.[teamCategory];
        return affinity !== undefined && affinity <= PACK_AFFINITY_THRESHOLD;
      })
    : sortedPacks.slice(0, 3); // fallback: first 3 packs

  if (packsToInstall.length === 0) {
    return { installed: 0, packSlugs: [] };
  }

  // Bulk insert install records (skip conflicts)
  const installRows = packsToInstall.map((p) => ({
    workspace_id: workspaceId,
    skill_pack_id: p.id,
    installed_by: userId,
    version_installed: p.version,
  }));

  const { error: installError } = await supabase
    .from('skill_pack_installs')
    .upsert(installRows, { onConflict: 'workspace_id,skill_pack_id' });

  if (installError) {
    console.error('[skill-loader] Seed install error:', installError.message);
    return { installed: 0, packSlugs: [] };
  }

  return {
    installed: packsToInstall.length,
    packSlugs: packsToInstall.map((p) => p.slug),
  };
}

/**
 * Check if a workspace can add more skills at their current plan.
 */
export async function canAddSkill(
  workspaceId: string,
  plan: string = 'cloud',
): Promise<{ allowed: boolean; current: number; max: number }> {
  const limits = TIER_LIMITS[resolveTier(plan)];

  // Service client: counts brain_manifest skills for limit check. Accesses: brain_manifest.
  const supabase = createServiceClient();

  const { count, error } = await supabase
    .from('brain_manifest')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('category', 'skill')
    .eq('is_enabled', true);

  if (error) {
    console.error('[skill-loader] Count error:', error);
    return { allowed: false, current: 0, max: limits.max_skills };
  }

  const current = count ?? 0;
  return {
    allowed: current < limits.max_skills,
    current,
    max: limits.max_skills,
  };
}
