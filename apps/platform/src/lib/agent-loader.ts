import { createServiceClient } from '@repo/db/service';
import { AGENTS } from '@/lib/agents-data';
import type { Agent, ParameterValues } from '@/lib/agents-data';

/**
 * Dynamic agent configuration row from the database.
 */
interface AgentConfigRow {
  agent_id: string;
  workspace_id: string;
  display_name: string | null;
  role: string | null;
  description: string | null;
  agent_type: string;
  model: string | null;
  color: string | null;
  persona_prompt: string | null;
  capabilities: string[];
  parameters: ParameterValues;
  permissions: string[] | null;
  is_active: boolean;
}

/**
 * Load agents for a workspace.
 * Returns DB-configured agents if they exist, otherwise falls back to hardcoded AGENTS.
 * When org sharing is enabled, merges inherited org agents (marked is_shared).
 *
 * This is the bridge between the legacy hardcoded system and the new dynamic system.
 * Once all workspaces have DB configs, the hardcoded fallback can be removed.
 */
export async function loadWorkspaceAgents(workspaceId: string): Promise<Agent[]> {
  try {
    // Service client: loads agent configs for any workspace without user-scoped RLS. Accesses: agent_configs.
    const supabase = createServiceClient();
    const { data: configs } = await supabase
      .from('agent_configs')
      .select(
        'agent_id, workspace_id, display_name, role, description, agent_type, model, color, persona_prompt, capabilities, parameters, permissions, is_active',
      )
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });

    if (!configs || configs.length === 0) {
      // Fallback to hardcoded agents for the main workspace
      return AGENTS;
    }

    const agents = configs.map((row: AgentConfigRow) => mapRowToAgent(row));

    // Check for org-level shared agents
    const sharedAgents = await loadOrgSharedAgents(supabase, workspaceId, agents);
    if (sharedAgents.length > 0) {
      agents.push(...sharedAgents);
    }

    return agents;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Failed to load agents from DB, falling back to defaults:', message);
    return AGENTS;
  }
}

function mapRowToAgent(row: AgentConfigRow, isShared = false): Agent {
  return {
    id: row.agent_id,
    name: row.display_name ?? row.agent_id.toUpperCase(),
    role: row.role ?? 'Agent',
    type: (row.agent_type ?? 'ai') as Agent['type'],
    status: 'standby' as const,
    model: row.model ?? undefined,
    description: row.description ?? '',
    parameters: row.parameters ?? {},
    activeProfile: 'default',
    depth: 1,
    permissions: (row.permissions ?? []) as Agent['permissions'],
    ...(isShared ? { is_shared: true, is_readonly: true } : {}),
  };
}

/**
 * Fetch org-level shared agents if sharing is enabled for the workspace's org.
 */
async function loadOrgSharedAgents(
  supabase: ReturnType<typeof createServiceClient>,
  workspaceId: string,
  existingAgents: Agent[],
): Promise<Agent[]> {
  try {
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('org_id')
      .eq('id', workspaceId)
      .single();

    if (!workspace?.org_id) return [];

    const { data: org } = await supabase
      .from('organizations')
      .select('metadata')
      .eq('id', workspace.org_id)
      .single();

    const metadata = (org?.metadata as Record<string, unknown> | null) ?? {};
    if (metadata.sharing_enabled !== true) return [];

    const { data: sharedAgents } = await supabase
      .from('org_shared_agents')
      .select(
        'agent_id, workspace_id, display_name, role, description, agent_type, model, color, persona_prompt, capabilities, parameters, permissions, is_active',
      )
      .eq('org_id', workspace.org_id)
      .order('created_at', { ascending: true });

    if (!sharedAgents || sharedAgents.length === 0) return [];

    const existingIds = new Set(existingAgents.map((a) => a.id));

    return sharedAgents
      .filter((s: AgentConfigRow) => !existingIds.has(s.agent_id))
      .map((s: AgentConfigRow) => mapRowToAgent(s, true));
  } catch {
    return [];
  }
}

/**
 * Load a single agent config by ID within a workspace.
 * Falls back to hardcoded AGENTS if not found in DB.
 */
export async function loadAgentConfig(workspaceId: string, agentId: string): Promise<Agent | null> {
  try {
    // Service client: loads a single agent config by ID without user-scoped RLS. Accesses: agent_configs.
    const supabase = createServiceClient();
    const { data: config } = await supabase
      .from('agent_configs')
      .select(
        'agent_id, workspace_id, display_name, role, description, agent_type, model, color, persona_prompt, capabilities, parameters, permissions, is_active',
      )
      .eq('workspace_id', workspaceId)
      .eq('agent_id', agentId)
      .single();

    if (config) {
      const row = config as AgentConfigRow;
      return {
        id: row.agent_id,
        name: row.display_name ?? row.agent_id.toUpperCase(),
        role: row.role ?? 'Agent',
        type: (row.agent_type ?? 'ai') as Agent['type'],
        status: 'standby',
        model: row.model ?? undefined,
        description: row.description ?? '',
        parameters: row.parameters ?? {},
        activeProfile: 'default',
        depth: 1,
        permissions: (row.permissions ?? []) as Agent['permissions'],
      };
    }
  } catch {
    // Fall through to hardcoded lookup
  }

  // Fallback to hardcoded
  return AGENTS.find((a) => a.id === agentId) ?? null;
}
