/**
 * Agent Employment — shared utility for checking if agents are employed in a workspace.
 *
 * Enforces the org-wide agent model:
 * - Agents are shared across all workspaces in an org (earliest config = source of truth)
 * - Only `is_active` varies per workspace
 * - Lead agents are always employed (is_active = true)
 *
 * Uses the `get_employed_agents` RPC for a single DB round-trip.
 * Falls back to multi-query approach if the RPC doesn't exist yet (pre-migration).
 */

import { createServiceClient } from '@repo/db/service';

export interface EmployedAgent {
  agent_id: string;
  display_name: string;
  role: string | null;
  agent_type: 'ai' | 'human';
  is_active: boolean;
}

/**
 * Returns the set of employed (active) agent IDs for a workspace.
 * Applies org-wide deduplication and lead-always-on rules.
 */
export async function getEmployedAgentIds(workspaceId: string): Promise<Set<string>> {
  const agents = await getEmployedAgents(workspaceId);
  return new Set(agents.map((a) => a.agent_id));
}

/**
 * Returns full employed agent records for a workspace.
 * Tries the consolidated RPC first (single query), falls back to multi-query.
 */
export async function getEmployedAgents(workspaceId: string): Promise<EmployedAgent[]> {
  const supabase = createServiceClient();

  // Try the consolidated RPC (single DB round-trip)
  const { data: rpcResult, error: rpcError } = await supabase.rpc('get_employed_agents', {
    p_workspace_id: workspaceId,
  });

  if (!rpcError && rpcResult) {
    return (
      rpcResult as {
        agent_id: string;
        display_name: string;
        role: string | null;
        agent_type: string;
        is_active: boolean;
      }[]
    ).map((row) => ({
      agent_id: row.agent_id,
      display_name: row.display_name,
      role: row.role,
      agent_type: row.agent_type as 'ai' | 'human',
      is_active: row.is_active,
    }));
  }

  // Fallback: multi-query approach (pre-migration compatibility)
  return getEmployedAgentsFallback(workspaceId, supabase);
}

/**
 * Check if a specific agent is employed in a workspace.
 * Returns true if the agent is active (or is a lead agent).
 */
export async function isAgentEmployed(workspaceId: string, agentId: string): Promise<boolean> {
  const employedIds = await getEmployedAgentIds(workspaceId);
  return employedIds.has(agentId);
}

/**
 * Fallback: 3-query approach for pre-migration environments.
 * Will be removed once the RPC is deployed everywhere.
 */
async function getEmployedAgentsFallback(
  workspaceId: string,
  supabase: ReturnType<typeof createServiceClient>,
): Promise<EmployedAgent[]> {
  // Query 1: Resolve org
  const { data: workspace, error: wsError } = await supabase
    .from('workspaces')
    .select('org_id')
    .eq('id', workspaceId)
    .single();

  if (wsError) throw new Error(`Failed to resolve workspace: ${wsError.message}`);
  if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

  // Query 2: Get all workspace IDs in this org
  const { data: orgWorkspaces, error: orgError } = await supabase
    .from('workspaces')
    .select('id')
    .eq('org_id', workspace.org_id);

  if (orgError) throw new Error(`Failed to query org workspaces: ${orgError.message}`);

  const orgWorkspaceIds = (orgWorkspaces ?? []).map((w) => w.id);
  if (orgWorkspaceIds.length === 0) orgWorkspaceIds.push(workspaceId);

  // Query 3: Fetch all agent configs across org
  const { data: allConfigs, error: configsError } = await supabase
    .from('agent_configs')
    .select('workspace_id, agent_id, display_name, role, agent_type, is_active')
    .in('workspace_id', orgWorkspaceIds)
    .order('created_at', { ascending: true });

  if (configsError) throw new Error(`Failed to query agent configs: ${configsError.message}`);
  if (!allConfigs) return [];

  // Build per-agent source of truth (earliest config) + per-workspace is_active overlay
  const configByAgent = new Map<string, (typeof allConfigs)[0]>();
  const localActiveMap = new Map<string, boolean>();

  for (const row of allConfigs) {
    if (row.workspace_id === workspaceId) {
      localActiveMap.set(row.agent_id, row.is_active);
    }
    if (!configByAgent.has(row.agent_id)) {
      configByAgent.set(row.agent_id, row);
    }
  }

  const employed: EmployedAgent[] = [];

  for (const [agentId, config] of configByAgent) {
    // Check is_lead column first, fall back to string matching for pre-migration data
    const isLead =
      (config as Record<string, unknown>).is_lead === true ||
      (config.role ?? '').toLowerCase().includes('lead');
    const hasLocalRecord = localActiveMap.has(agentId);

    let isActive: boolean;
    if (isLead) {
      isActive = true; // Lead agents always employed
    } else if (hasLocalRecord) {
      isActive = localActiveMap.get(agentId)!;
    } else {
      isActive = false; // No record in this workspace = not employed
    }

    if (isActive) {
      employed.push({
        agent_id: agentId,
        display_name: config.display_name,
        role: config.role,
        agent_type: config.agent_type as 'ai' | 'human',
        is_active: true,
      });
    }
  }

  return employed;
}
