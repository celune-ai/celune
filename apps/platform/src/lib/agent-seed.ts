import { createServiceClient } from '@repo/db/service';
import { matchTemplateForOnboarding, CORE_AGENT_IDS } from '@repo/db/team-templates';
import type { AgentTemplate, TeamCategory } from '@repo/db/team-templates';
import { PLAN_TIERS } from '@repo/types';
import type { Plan } from '@repo/types';

// ---------------------------------------------------------------------------
// Avatar icon helpers
// ---------------------------------------------------------------------------

const TOTAL_AVATARS = 35;

/** Get a shuffled list of available avatar paths, excluding already-used ones. */
function getAvailableAvatars(usedIcons: string[]): string[] {
  const used = new Set(usedIcons);
  const available: string[] = [];
  for (let i = 1; i <= TOTAL_AVATARS; i++) {
    const path = `/avatars/Shape_${i}.png`;
    if (!used.has(path)) available.push(path);
  }
  // Fisher-Yates shuffle
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }
  return available;
}

// ---------------------------------------------------------------------------
// Pod inference from template category
// ---------------------------------------------------------------------------

export const CATEGORY_TO_POD: Record<TeamCategory, string> = {
  software: 'product',
  marketing: 'marketing',
  content: 'content',
  business: 'business',
  creative: 'creative',
  operations: 'operations',
  'professional-services': 'services',
  personal: 'personal',
};

// ---------------------------------------------------------------------------
// Plan tier → active agent limits
// ---------------------------------------------------------------------------

/** Max **active** agents per plan. All agents are seeded; only this many start active. */
export function maxActiveAgentsForPlan(plan: Plan): number {
  const max = (PLAN_TIERS[plan] ?? PLAN_TIERS.cloud).max_agents;
  return max ?? 999; // effectively unlimited
}

// ---------------------------------------------------------------------------
// Seed result
// ---------------------------------------------------------------------------

export interface SeedResult {
  seeded: number;
  skipped: number;
  agentIds: string[];
  templateId: string;
  templateName: string;
  templateCategory?: TeamCategory;
}

// ---------------------------------------------------------------------------
// Copy agents between workspaces
// ---------------------------------------------------------------------------

/**
 * Copies agent configs from one workspace to another.
 * Used when the org has "reuse agents across workspaces" enabled.
 *
 * SECURITY: Callers MUST verify that `userId` has membership in BOTH
 * sourceWorkspaceId and targetWorkspaceId before calling this function.
 */
export async function copyAgentsFromWorkspace(
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  userId: string,
): Promise<Omit<SeedResult, 'templateId' | 'templateName'>> {
  const supabase = createServiceClient();

  // Verify user has membership in source workspace
  const { data: sourceMembership } = await supabase
    .from('workspace_memberships')
    .select('id')
    .eq('workspace_id', sourceWorkspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!sourceMembership) {
    throw new Error('User does not have membership in source workspace');
  }

  const { data: sourceAgents, error: fetchError } = await supabase
    .from('agent_configs')
    .select(
      'agent_id, display_name, role, description, agent_type, model, color, icon, pod, persona_prompt, capabilities, parameters, permissions, is_active',
    )
    .eq('workspace_id', sourceWorkspaceId);

  if (fetchError) {
    throw new Error(`Failed to fetch source agents: ${fetchError.message}`);
  }

  if (!sourceAgents || sourceAgents.length === 0) {
    return { seeded: 0, skipped: 0, agentIds: [] };
  }

  const { data: existing } = await supabase
    .from('agent_configs')
    .select('agent_id')
    .eq('workspace_id', targetWorkspaceId);

  const existingIds = new Set((existing ?? []).map((r: { agent_id: string }) => r.agent_id));
  const toInsert = sourceAgents.filter((a) => !existingIds.has(a.agent_id));

  if (toInsert.length === 0) {
    return {
      seeded: 0,
      skipped: sourceAgents.length,
      agentIds: sourceAgents.map((a) => a.agent_id),
    };
  }

  const rows = toInsert.map((a) => ({
    workspace_id: targetWorkspaceId,
    agent_id: a.agent_id,
    display_name: a.display_name,
    role: a.role,
    description: a.description,
    agent_type: a.agent_type,
    model: a.model,
    color: a.color,
    icon: (a as Record<string, unknown>).icon ?? null,
    pod: (a as Record<string, unknown>).pod ?? null,
    persona_prompt: a.persona_prompt,
    capabilities: a.capabilities ?? [],
    parameters: a.parameters ?? {},
    permissions: a.permissions ?? [],
    user_id: userId,
    is_active: a.is_active ?? true,
  }));

  const { error } = await supabase.from('agent_configs').insert(rows);

  if (error) {
    throw new Error(`Failed to copy agents: ${error.message}`);
  }

  return {
    seeded: toInsert.length,
    skipped: sourceAgents.length - toInsert.length,
    agentIds: sourceAgents.map((a) => a.agent_id),
  };
}

// ---------------------------------------------------------------------------
// Seed from team template library (primary path)
// ---------------------------------------------------------------------------

/**
 * Seeds agents for a workspace from the team template library.
 *
 * 1. Matches the best template based on useCase / role / goal.
 * 2. Skips the generic 'lead' agent from the template — the user's
 *    onboarding agent serves as team lead instead.
 * 3. Seeds remaining agents into agent_configs.
 * 4. Marks only the top N as `is_active = true` based on the plan tier.
 *    The rest are seeded with `is_active = false` — visible but not employed.
 *
 * Idempotent — skips agents that already exist.
 */
export async function seedDefaultAgents(
  workspaceId: string,
  plan: Plan,
  userId: string,
  useCase?: string,
  opts?: { role?: string; goal?: string },
): Promise<SeedResult> {
  const supabase = createServiceClient();
  const template = matchTemplateForOnboarding({
    useCase,
    role: opts?.role,
    goal: opts?.goal,
  });
  const maxActive = maxActiveAgentsForPlan(plan);

  // Fetch existing agents for this workspace to avoid duplicates
  const { data: existing } = await supabase
    .from('agent_configs')
    .select('agent_id, icon')
    .eq('workspace_id', workspaceId);

  const existingIds = new Set((existing ?? []).map((r: { agent_id: string }) => r.agent_id));
  const usedIcons = (existing ?? [])
    .map((r: { icon?: string | null }) => r.icon)
    .filter((i): i is string => !!i);

  // Check if the user already has a lead agent (created via AgentLeadWizard).
  // If not, seed the template's lead agent so every team has a lead.
  const hasUserLead = [...existingIds].some((id) => !SEED_IDS.has(id));
  const leadTemplate = template.agents.find((a) => a.agent_id === 'lead');

  // Build the list of agents to seed: always include template subagents,
  // and include the lead agent if the user didn't create one during onboarding.
  const teamAgents = template.agents.filter((a) => {
    if (a.agent_id === 'lead') return !hasUserLead; // Only include lead if user doesn't have one
    return true;
  });
  const toInsert = teamAgents.filter((a) => !existingIds.has(a.agent_id));

  if (toInsert.length === 0) {
    // Still promote the user's agent to Team Lead if needed
    await promoteUserAgentToLead(supabase, workspaceId, existingIds, template.category);
    return {
      seeded: 0,
      skipped: template.agents.length,
      agentIds: template.agents.map((a) => a.agent_id),
      templateId: template.id,
      templateName: template.name,
      templateCategory: template.category,
    };
  }

  // The user's onboarding agent counts as 1 active slot already
  const userAgentCount = hasUserLead ? 1 : 0;

  // Get shuffled available avatars for new agents
  const avatars = getAvailableAvatars(usedIcons);
  const pod = CATEGORY_TO_POD[template.category] ?? 'general';

  const rows = toInsert.map((a: AgentTemplate, idx: number) => {
    // All agents up to the plan limit start as active (employed).
    // Only agents beyond the limit start inactive.
    const activeSlotIdx = idx + userAgentCount;

    return {
      workspace_id: workspaceId,
      agent_id: a.agent_id,
      display_name: a.display_name,
      role: a.role,
      description: a.description,
      agent_type: 'ai' as const,
      model: a.model,
      color: a.color,
      icon: avatars[idx] ?? null,
      pod,
      persona_prompt: a.persona_prompt,
      capabilities: [],
      parameters: a.parameters,
      permissions: a.permissions,
      user_id: userId,
      is_active: activeSlotIdx < maxActive,
    };
  });

  const { error } = await supabase.from('agent_configs').insert(rows);

  if (error) {
    throw new Error(`Failed to seed agents: ${error.message}`);
  }

  // Promote the user's onboarding agent to Team Lead with pod + icon
  if (hasUserLead) {
    await promoteUserAgentToLead(supabase, workspaceId, existingIds, template.category);
  }

  return {
    seeded: toInsert.length,
    skipped: template.agents.length - toInsert.length,
    agentIds: teamAgents.map((a) => a.agent_id),
    templateId: template.id,
    templateName: template.name,
    templateCategory: template.category,
  };
}

// ---------------------------------------------------------------------------
// Promote user's onboarding agent to Team Lead
// ---------------------------------------------------------------------------

/** Seed IDs that belong to templates — any agent NOT in this set is the user's custom agent. */
const SEED_IDS = CORE_AGENT_IDS;

/**
 * Finds the user's custom onboarding agent and ensures it has:
 * - role = 'Team Lead'
 * - pod assignment (if missing)
 * - icon (if missing)
 */
async function promoteUserAgentToLead(
  supabase: ReturnType<typeof createServiceClient>,
  workspaceId: string,
  existingIds: Set<string>,
  category: string,
): Promise<void> {
  // Find the user's custom agent (not a seed agent)
  const userAgentId = [...existingIds].find((id) => !SEED_IDS.has(id));
  if (!userAgentId) return;

  const pod = CATEGORY_TO_POD[category as TeamCategory] ?? 'general';

  // Fetch current state to avoid overwriting user's choices
  const { data: agent } = await supabase
    .from('agent_configs')
    .select('role, pod, icon')
    .eq('workspace_id', workspaceId)
    .eq('agent_id', userAgentId)
    .maybeSingle();

  if (!agent) return;

  const updates: Record<string, string> = {};
  if (!agent.role || agent.role === 'AI Assistant') updates.role = 'Team Lead';
  if (!agent.pod) updates.pod = pod;
  if (!agent.icon) {
    const usedIcons = await getUsedIconsInWorkspace(supabase, workspaceId);
    const available = getAvailableAvatars(usedIcons);
    if (available.length > 0) updates.icon = available[0];
  }

  if (Object.keys(updates).length > 0) {
    await supabase
      .from('agent_configs')
      .update(updates)
      .eq('workspace_id', workspaceId)
      .eq('agent_id', userAgentId);
  }
}

async function getUsedIconsInWorkspace(
  supabase: ReturnType<typeof createServiceClient>,
  workspaceId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('agent_configs')
    .select('icon')
    .eq('workspace_id', workspaceId);
  return (data ?? []).map((r: { icon?: string | null }) => r.icon).filter((i): i is string => !!i);
}
