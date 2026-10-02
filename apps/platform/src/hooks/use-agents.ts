'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';
import { useWorkspace } from '@/providers/workspace-provider';
import { usePlan } from './use-plan';
import { AGENT_COLORS } from '@/lib/agents-data';
import type { Agent, AgentColor } from '@/lib/agents-data';
import { CORE_AGENT_IDS } from '@repo/db/team-templates';

interface AgentConfigRow {
  agent_id: string;
  display_name: string | null;
  role: string | null;
  description: string | null;
  agent_type: string;
  model: string | null;
  color: string | null;
  icon: string | null;
  pod: string | null;
  parameters: Record<string, number>;
  permissions: string[] | null;
  is_active: boolean;
  is_shared?: boolean;
  is_readonly?: boolean;
}

/** IDs used by seedDefaultAgents — these are subagents, not user-created leads.
 *  The 'lead' agent from the template IS a lead, so exclude it from this set. */
const SEED_AGENT_IDS = new Set([...CORE_AGENT_IDS].filter((id) => id !== 'lead'));

const DEFAULT_COLOR: AgentColor = {
  hex: '#71717A',
  text: 'text-zinc-500',
  bg: 'bg-zinc-500',
  border: 'border-zinc-500',
  ring: 'ring-zinc-500/60',
};

function mapConfigToAgent(row: AgentConfigRow, depth?: number): Agent {
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
    depth: depth ?? 1,
    permissions: (row.permissions ?? []) as Agent['permissions'],
    icon: row.icon ?? undefined,
    pod: (row.pod ?? undefined) as Agent['pod'],
    ...(row.is_shared ? { is_shared: true, is_readonly: true } : {}),
    is_active: row.is_active,
  };
}

function buildAgentColor(agent: Agent, row?: AgentConfigRow): AgentColor {
  // Use hardcoded color if available (for known agent IDs)
  if (AGENT_COLORS[agent.id]) return AGENT_COLORS[agent.id];
  // Use DB color if available
  const hex = row?.color ?? '#71717A';
  return {
    hex,
    text: `text-[${hex}]`,
    bg: `bg-[${hex}]`,
    border: `border-[${hex}]`,
    ring: `ring-[${hex}]/60`,
  };
}

/**
 * Hook that loads agent definitions for the current workspace.
 *
 * Behavior:
 * - Platform owner workspace: falls back to hardcoded AGENTS array
 * - External workspaces: loads from DB via /api/agents/configs
 * - If no agents found in DB: auto-seeds via /api/agents/seed, then re-fetches
 */
export function useAgents() {
  const { activeWorkspace } = useWorkspace();
  const { isPlatformOwner, isLoading: planLoading, isWorkspaceOwner } = usePlan();
  const [dbAgents, setDbAgents] = useState<Agent[] | null>(null);
  const [dbConfigs, setDbConfigs] = useState<AgentConfigRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const seedAttemptedRef = useRef<string | null>(null);

  const workspaceId = activeWorkspace?.id;

  const fetchAgents = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const configs = await fetchJson<AgentConfigRow[]>(
        apiUrl(`/api/agents/configs?workspace_id=${workspaceId}`),
      );
      if (configs.length > 0) {
        setDbConfigs(configs);
        // Build hierarchy by role:
        // - Lead Agents → depth 1 (root, shown first)
        // - Guardian agents → depth 1 (root, shown at bottom)
        // - All other agents → depth 2 (nested under lead)
        const isLeadRole = (c: AgentConfigRow) => c.role?.toLowerCase().includes('lead');
        const isGuardianRole = (c: AgentConfigRow) => c.role?.toLowerCase().includes('guardian');

        const leads = configs.filter((c) => isLeadRole(c));
        const guardians = configs.filter((c) => isGuardianRole(c) && !isLeadRole(c));
        const subs = configs.filter((c) => !isLeadRole(c) && !isGuardianRole(c));

        const sortByActive = (a: AgentConfigRow, b: AgentConfigRow) =>
          (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0);
        leads.sort(sortByActive);
        subs.sort(sortByActive);
        guardians.sort(sortByActive);

        // Leads first, then subs nested under them, then guardians at bottom
        const ordered = [...leads, ...subs, ...guardians];
        setDbAgents(
          ordered.map((c) => mapConfigToAgent(c, isLeadRole(c) || isGuardianRole(c) ? 1 : 2)),
        );
        setDbConfigs(ordered);
      } else {
        setDbConfigs([]);
        setDbAgents(null);
      }
    } catch {
      setDbConfigs([]);
      setDbAgents(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  // Auto-seed agents when none exist in the workspace.
  // Wait for plan to load before acting.
  useEffect(() => {
    if (!workspaceId || planLoading || loading) return;
    // Only attempt auto-seed once per workspace
    if (seedAttemptedRef.current === workspaceId) return;
    // Only seed if we've fetched and found nothing
    if (dbAgents !== null) return;
    // dbAgents is null AND loading is false means fetch completed with 0 results
    if (seeded) return;

    seedAttemptedRef.current = workspaceId;

    fetchJson<{ seeded: number; agentIds: string[] }>(apiUrl('/api/agents/seed'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId }),
    })
      .then((result) => {
        setSeeded(true);
        if (result.seeded > 0) {
          // Re-fetch to pick up the seeded agents
          fetchAgents();
        }
      })
      .catch(() => {
        // Seed failed — stay on fallback
        setSeeded(true);
      });
  }, [workspaceId, planLoading, loading, dbAgents, seeded, fetchAgents]);

  // Fetch agents from DB for all workspaces.
  // Don't wait for plan — agent list doesn't depend on plan data.
  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Reset seed state when workspace changes
  useEffect(() => {
    setSeeded(false);
    setDbAgents(null);
    setDbConfigs([]);
  }, [workspaceId]);

  // All workspaces use DB agents. Show empty until DB responds.
  const agents = dbAgents ?? [];

  const agentColors: Record<string, AgentColor> = dbAgents
    ? Object.fromEntries(dbAgents.map((a, i) => [a.id, buildAgentColor(a, dbConfigs[i])]))
    : {};

  const agentLabels: Record<string, string> = dbAgents
    ? Object.fromEntries(agents.map((a) => [a.id, a.name]))
    : {};

  const agentIds: string[] = dbAgents ? agents.map((a) => a.id) : [];

  /** True when agents come from the DB (not hardcoded fallback) */
  const isDbBacked = dbAgents !== null;

  return {
    agents,
    agentColors,
    agentLabels,
    agentIds,
    loading,
    refetch: fetchAgents,
    isDbBacked,
    isPlatformOwner,
    isOwner: isPlatformOwner || isWorkspaceOwner,
  };
}
