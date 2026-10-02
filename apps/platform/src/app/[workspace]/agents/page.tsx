'use client';

import { Bot, ChevronDown, User, CornerDownRight, Plus, Library, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { PageTabs } from '@/components/page-tabs';
import type { PageTab } from '@/components/page-tabs';
import { useFlag } from '@/hooks/use-flags';
import { Button } from '@repo/ui/components/button';
import { Switch } from '@repo/ui/components/switch';
import dynamic from 'next/dynamic';
import { PageActionBar } from '@/components/page-action-bar';
import { DelegationFlowTab } from '@/components/agents/delegation-flow-tab';

const AgentHealthDashboard = dynamic(
  () => import('@/components/health/agent-health-dashboard').then((m) => m.AgentHealthDashboard),
  {
    ssr: false,
    loading: () => <div className="bg-surface-100 h-[400px] animate-pulse rounded-lg" />,
  },
);
import { ActivityFeed } from '@/components/team/activity-feed';
import { AgentMessages } from '@/components/team/agent-messages';
import { AgentLeadWizard } from '@/components/onboarding/agent-lead-wizard';
import { TeamTemplatePicker } from '@/components/agents/team-template-picker';
import { useCanCreateAgent } from '@/hooks/use-can-create-agent';
import { useWorkspace } from '@/providers/workspace-provider';
import { usePlan } from '@/hooks/use-plan';
import {
  AGENTS,
  AGENT_COLORS,
  POD_LABELS,
  POD_COLORS,
  type Agent,
  type AgentStatus,
  type AgentPod,
} from '@/lib/agents-data';
import { AGENT_AVATAR_MAP } from '@/lib/default-avatars';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { useAgents } from '@/hooks/use-agents';
import { CORE_AGENT_IDS } from '@repo/db/team-templates';

// ---------------------------------------------------------------------------
// Live status
// ---------------------------------------------------------------------------

interface LiveStatus {
  status: string;
  last_heartbeat: string | null;
  current_task_id: string | null;
  model: string | null;
}

function useLiveStatus() {
  const [liveStatus, setLiveStatus] = useState<Record<string, LiveStatus>>({});
  useEffect(() => {
    const fetchStatus = () => {
      fetchJson<Record<string, LiveStatus>>('/api/agents/status')
        .then((data) => {
          if (data && typeof data === 'object' && !data.error) setLiveStatus(data);
        })
        .catch(() => {
          /* Non-blocking — status refreshes on next poll */
        });
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);
  return liveStatus;
}

interface RosterHealth {
  healthy: boolean;
  drift: {
    inCodeNotStatus: string[];
    inStatusNotCode: string[];
    inCodeNotConfig: string[];
    inConfigNotCode: string[];
  };
}

function useRosterHealth() {
  const [health, setHealth] = useState<RosterHealth | null>(null);
  useEffect(() => {
    fetchJson<RosterHealth>('/api/agents/health')
      .then((data) => {
        if (data && typeof data === 'object' && 'healthy' in data) setHealth(data);
      })
      .catch(() => {
        /* Non-critical — health badge simply won't render */
      });
  }, []);
  return health;
}

function formatModel(model: string | undefined): string {
  if (!model) return '—';
  const m = model.toLowerCase();
  if (m.includes('opus') && (m.includes('4-6') || m.includes('4.6'))) return 'Opus 4.6';
  if (m.includes('opus') && (m.includes('4-5') || m.includes('4.5'))) return 'Opus 4.5';
  if (m.includes('opus')) return 'Opus';
  if (m.includes('sonnet') && (m.includes('4-6') || m.includes('4.6'))) return 'Sonnet 4.6';
  if (m.includes('sonnet') && (m.includes('4-5') || m.includes('4.5'))) return 'Sonnet 4.5';
  if (m.includes('sonnet') && (m.includes('3-5') || m.includes('3.5'))) return 'Sonnet 3.5';
  if (m.includes('sonnet')) return 'Sonnet';
  if (m.includes('haiku') && (m.includes('4-5') || m.includes('4.5'))) return 'Haiku 4.5';
  if (m.includes('haiku') && (m.includes('3-5') || m.includes('3.5'))) return 'Haiku 3.5';
  if (m.includes('haiku')) return 'Haiku';
  if (m.includes('gpt-4o')) return 'GPT-4o';
  if (m.includes('gpt-4')) return 'GPT-4';
  if (m.includes('o1')) return 'o1';
  return model;
}

function mapLiveStatus(raw: string, lastHeartbeat: string | null): AgentStatus {
  switch (raw) {
    case 'online': {
      if (lastHeartbeat) {
        const age = Date.now() - new Date(lastHeartbeat).getTime();
        if (age > 60 * 60 * 1000) return 'idle';
      }
      return 'standby';
    }
    case 'working':
      return 'working';
    case 'idle':
      return 'idle';
    case 'offline':
      return 'unreachable';
    default:
      return 'unreachable';
  }
}

// ---------------------------------------------------------------------------
// Hierarchy helpers
// ---------------------------------------------------------------------------

function buildParentMap(agents: Agent[]): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    let parentId: string | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (agents[j].depth === agent.depth - 1) {
        parentId = agents[j].id;
        break;
      }
    }
    map[agent.id] = parentId;
  }
  return map;
}

function buildChildrenMap(
  agents: Agent[],
  parentMap: Record<string, string | null>,
): Record<string, Agent[]> {
  const map: Record<string, Agent[]> = {};
  for (const agent of agents) {
    const parent = parentMap[agent.id];
    if (parent != null) {
      if (!map[parent]) map[parent] = [];
      map[parent].push(agent);
    }
  }
  return map;
}

// Static maps for the hardcoded platform agents (backward compat)
const STATIC_PARENT_MAP = buildParentMap(AGENTS);
const STATIC_CHILDREN_MAP = buildChildrenMap(AGENTS, STATIC_PARENT_MAP);

// ---------------------------------------------------------------------------
// Grid layout
// ---------------------------------------------------------------------------

const GRID_COLS = '1fr 240px 90px 70px 160px 110px 130px';
const TRANSITION_MS = 200;

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<AgentStatus, string> = {
  provisional: 'bg-violet-500/10 text-violet-500 border-violet-500/20',
  standby: 'bg-warning/10 text-warning border-warning/20',
  idle: 'bg-surface-200 text-foreground-lighter border-border',
  working: 'bg-brand/10 text-brand border-brand/20',
  unreachable: 'bg-destructive/10 text-destructive border-destructive/20',
};
const STATUS_DOT: Record<AgentStatus, string> = {
  provisional: 'bg-violet-500',
  standby: 'bg-warning',
  idle: 'bg-foreground-lighter',
  working: 'bg-brand',
  unreachable: 'bg-destructive',
};
const STATUS_LABELS: Record<AgentStatus, string> = {
  provisional: 'Provisional',
  standby: 'Standby',
  idle: 'Idle',
  working: 'Working',
  unreachable: 'Unreachable',
};

function StatusBadge({
  status,
  isActive,
  agentHex,
  isInactive,
}: {
  status: AgentStatus;
  isActive?: boolean;
  agentHex?: string;
  /** Agent is benched (is_active=false) — show "Inactive" regardless of live status */
  isInactive?: boolean;
}) {
  if (isInactive) {
    return (
      <span className="bg-surface-200 text-foreground-lighter border-border inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium">
        <span className="bg-foreground-lighter/50 inline-block h-2 w-2 rounded-full" />
        Inactive
      </span>
    );
  }
  if (isActive && agentHex) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"
        style={{
          backgroundColor: `${agentHex}15`,
          color: agentHex,
          borderColor: `${agentHex}30`,
        }}
      >
        <span
          className="inline-block h-2 w-2 animate-pulse rounded-full"
          style={{ backgroundColor: agentHex }}
        />
        Active
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABELS[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pod badge
// ---------------------------------------------------------------------------

function PodBadge({ pod }: { pod?: AgentPod }) {
  if (!pod) return <span className="text-foreground-lighter text-xs">&mdash;</span>;
  const color = POD_COLORS[pod];
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${color.hex}15`, color: color.hex, borderColor: `${color.hex}30` }}
    >
      {POD_LABELS[pod]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Collapsible group — pure CSS animation via grid-template-rows
// ---------------------------------------------------------------------------

function CollapsibleGroup({
  collapsed,
  children,
}: {
  collapsed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateRows: collapsed ? '0fr' : '1fr',
        transition: `grid-template-rows ${TRANSITION_MS}ms ease`,
      }}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent row (div-based grid)
// ---------------------------------------------------------------------------

function AgentRow({
  agent,
  agentColorOverride,
  liveStatus,
  ericLastMessage,
  isCollapsed,
  onToggle,
  childCount,
  userAvatarUrl,
  onToggleActive,
  canActivate,
  showActiveToggle,
  togglingId,
}: {
  agent: Agent;
  agentColorOverride?: { hex: string; text: string; bg: string; border: string; ring: string };
  liveStatus: Record<string, LiveStatus>;
  ericLastMessage: number | null;
  isCollapsed: boolean;
  onToggle: (() => void) | null;
  childCount: number;
  userAvatarUrl: string | null;
  onToggleActive?: (agentId: string, active: boolean) => void;
  canActivate?: boolean;
  showActiveToggle?: boolean;
  togglingId?: string | null;
}) {
  const router = useRouter();
  const { workspaceHref } = useWorkspaceHref();
  const isConfigurable = agent.type === 'ai' && !agent.is_readonly;
  const live = liveStatus[agent.name.toLowerCase()] ?? liveStatus[agent.id];
  const agentColor = agentColorOverride ?? AGENT_COLORS[agent.id];

  let resolvedStatus: AgentStatus;
  if (agent.type === 'human') {
    if (ericLastMessage) {
      const age = Date.now() - ericLastMessage;
      resolvedStatus = age < 60 * 60 * 1000 ? 'standby' : 'idle';
    } else {
      resolvedStatus = 'idle';
    }
  } else {
    resolvedStatus = live ? mapLiveStatus(live.status, live.last_heartbeat) : agent.status;
  }

  const isActive = resolvedStatus === 'working' && !!live?.current_task_id;
  const activeHex = agentColor?.hex ?? '#34B27B';

  return (
    <div
      role="row"
      className={`border-border grid items-center border-b ${
        isActive
          ? 'animate-agent-active'
          : resolvedStatus === 'working'
            ? 'row-working'
            : 'transition-colors'
      } ${isConfigurable ? 'hover:bg-surface-100/50 cursor-pointer' : 'hover:bg-surface-100/30'} ${
        agent.type === 'ai' && !(agent.is_active ?? true) ? 'opacity-50' : ''
      }`}
      style={{
        gridTemplateColumns: GRID_COLS,
        ...(isActive && agentColor
          ? ({
              '--agent-active-color': activeHex,
              boxShadow: `inset 3px 0 0 ${activeHex}`,
            } as React.CSSProperties)
          : resolvedStatus === 'working' && agentColor
            ? ({ '--agent-shimmer-color': agentColor.hex } as React.CSSProperties)
            : {}),
      }}
      onClick={() => isConfigurable && router.push(workspaceHref(`/agents/${agent.id}`))}
    >
      {/* Member */}
      <div role="cell" className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          {agent.depth > 1 && (
            <CornerDownRight className="text-foreground-lighter ml-5 h-4 w-4 shrink-0" />
          )}
          <div className="bg-surface-100 border-border flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border">
            {agent.type === 'human' && userAvatarUrl ? (
              <Image
                src={userAvatarUrl}
                alt={agent.name}
                className="h-full w-full object-cover"
                width={40}
                height={40}
              />
            ) : agent.icon ? (
              <Image
                src={agent.icon}
                alt={agent.name}
                className="h-full w-full object-cover"
                width={40}
                height={40}
                unoptimized
              />
            ) : AGENT_AVATAR_MAP[agent.id] ? (
              <Image
                src={AGENT_AVATAR_MAP[agent.id]}
                alt={agent.name}
                className="h-full w-full object-cover"
                width={40}
                height={40}
                unoptimized
              />
            ) : agent.type === 'human' ? (
              <User className="text-foreground h-4 w-4" />
            ) : (
              <Bot className="text-foreground h-4 w-4" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-foreground truncate text-sm font-medium">{agent.name}</p>
              {agent.is_shared && (
                <span className="bg-brand/10 text-brand border-brand/20 shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] leading-none font-medium">
                  Shared
                </span>
              )}
            </div>
            <p className="text-foreground-lighter line-clamp-1 text-xs">{agent.description}</p>
          </div>
        </div>
      </div>

      {/* Role */}
      <div role="cell" className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          {agentColor && (
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: agentColor.hex }}
            />
          )}
          <span className="text-foreground-light text-sm">{agent.role}</span>
        </div>
      </div>

      {/* Pod */}
      <div role="cell" className="px-4 py-3.5">
        <PodBadge pod={agent.pod} />
      </div>

      {/* Type */}
      <div role="cell" className="px-4 py-3.5">
        <span
          className={`text-xs font-medium ${
            agent.type === 'ai' ? 'text-brand' : 'text-foreground-lighter'
          }`}
        >
          {agent.type === 'human' ? 'Human' : 'AI'}
        </span>
      </div>

      {/* Model */}
      <div role="cell" className="text-foreground-lighter px-4 py-3.5 text-xs">
        {formatModel(agent.model)}
      </div>

      {/* Status */}
      <div role="cell" className="px-4 py-3.5">
        <StatusBadge
          status={resolvedStatus}
          isActive={isActive}
          agentHex={isActive ? activeHex : undefined}
          isInactive={showActiveToggle && agent.type === 'ai' && !(agent.is_active ?? true)}
        />
      </div>

      {/* Employed toggle */}
      <div
        role="cell"
        className="flex items-center gap-2 px-4 py-3.5"
        onClick={(e) => e.stopPropagation()}
      >
        {agent.type === 'ai' ? (
          (() => {
            const isActive = agent.is_active ?? true;
            const isLead = agent.role?.toLowerCase().includes('lead');
            const isToggling = togglingId === agent.id;
            return (
              <div className="flex items-center gap-2">
                <Switch
                  checked={isActive}
                  onCheckedChange={(checked) => {
                    if (onToggleActive) onToggleActive(agent.id, checked);
                  }}
                  disabled={isLead || isToggling || (!isActive && !canActivate)}
                  aria-label={`Employ ${agent.name}`}
                />
                {isToggling ? (
                  <Loader2 className="text-foreground-lighter h-3.5 w-3.5 animate-spin" />
                ) : (
                  <span
                    className={`text-xs ${isActive ? 'text-foreground' : 'text-foreground-lighter'}`}
                  >
                    {isActive ? 'Employed' : 'Off'}
                  </span>
                )}
              </div>
            );
          })()
        ) : (
          <span className="text-foreground-lighter text-xs">&mdash;</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/** Start all groups expanded — users should see their full team. */
function getDefaultCollapsed(_agents: Agent[], _childrenMap: Record<string, Agent[]>): Set<string> {
  return new Set<string>();
}

// ---------------------------------------------------------------------------
// Agent roster table (extracted for tab layout)
// ---------------------------------------------------------------------------

function AgentRosterTab({
  agents: agentList,
  agentColors: colorMap,
  liveStatus,
  ericLastMessage,
  userAvatarUrl,
  isPlatformView,
  workspaceId,
  onAgentsChange,
  maxActiveAgents,
  loading,
  skeletonRows,
}: {
  agents: Agent[];
  agentColors: Record<
    string,
    { hex: string; text: string; bg: string; border: string; ring: string }
  >;
  liveStatus: Record<string, LiveStatus>;
  ericLastMessage: number | null;
  userAvatarUrl: string | null;
  isPlatformView: boolean;
  workspaceId?: string;
  onAgentsChange?: () => void;
  maxActiveAgents?: number;
  loading?: boolean;
  skeletonRows?: number;
}) {
  // Compute hierarchy maps from the provided agents list
  const parentMap = isPlatformView ? STATIC_PARENT_MAP : buildParentMap(agentList);
  const childrenMap = isPlatformView ? STATIC_CHILDREN_MAP : buildChildrenMap(agentList, parentMap);

  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    getDefaultCollapsed(agentList, childrenMap),
  );
  const [toggling, setToggling] = useState<string | null>(null);

  const toggleAgent = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Employ/bench toggle for non-platform workspaces
  const showActiveToggle = !isPlatformView && !!workspaceId;
  const activeCount = agentList.filter((a) => a.type === 'ai' && (a.is_active ?? true)).length;
  const maxActive = maxActiveAgents ?? 999;
  const canActivateMore = activeCount < maxActive;

  const handleToggleActive = useCallback(
    async (agentId: string, active: boolean) => {
      if (!workspaceId || toggling) return;
      setToggling(agentId);
      try {
        await fetchJson('/api/agents/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace_id: workspaceId, agent_id: agentId, is_active: active }),
        });
        onAgentsChange?.();
      } catch {
        /* Error is non-blocking — refetch will correct state */
      } finally {
        setToggling(null);
      }
    },
    [workspaceId, toggling, onAgentsChange],
  );

  function renderAgent(agent: Agent): React.ReactNode {
    const children = childrenMap[agent.id] ?? [];
    const hasChildren = children.length > 0;

    return (
      <Fragment key={agent.id}>
        <AgentRow
          agent={agent}
          agentColorOverride={colorMap[agent.id]}
          liveStatus={liveStatus}
          ericLastMessage={ericLastMessage}
          isCollapsed={collapsed.has(agent.id)}
          onToggle={hasChildren ? () => toggleAgent(agent.id) : null}
          childCount={children.length}
          userAvatarUrl={userAvatarUrl}
          showActiveToggle={showActiveToggle}
          onToggleActive={handleToggleActive}
          canActivate={canActivateMore}
          togglingId={toggling}
        />
        {hasChildren && (
          <CollapsibleGroup collapsed={collapsed.has(agent.id)}>
            {children.map((child) => renderAgent(child))}
          </CollapsibleGroup>
        )}
      </Fragment>
    );
  }

  const rootAgents = agentList.filter((a) => parentMap[a.id] == null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-foreground-lighter text-sm">
          Configure AI agents, adjust personality parameters, and manage roles across the
          organization.
        </p>
        {showActiveToggle && (
          <span className="text-foreground-lighter shrink-0 text-xs tabular-nums">
            {activeCount} employed / {agentList.filter((a) => a.type === 'ai').length} total
          </span>
        )}
      </div>

      <div
        role="table"
        aria-label="Team members and agent status"
        className="border-border overflow-hidden rounded-lg border text-sm"
      >
        {/* Header */}
        <div
          role="row"
          className="border-border bg-surface-100 grid border-b"
          style={{ gridTemplateColumns: GRID_COLS }}
        >
          <div
            role="columnheader"
            className="text-foreground-lighter px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
          >
            Member
          </div>
          <div
            role="columnheader"
            className="text-foreground-lighter px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
          >
            Role
          </div>
          <div
            role="columnheader"
            className="text-foreground-lighter px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
          >
            Pod
          </div>
          <div
            role="columnheader"
            className="text-foreground-lighter px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
          >
            Type
          </div>
          <div
            role="columnheader"
            className="text-foreground-lighter px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
          >
            Model
          </div>
          <div
            role="columnheader"
            className="text-foreground-lighter px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
          >
            Status
          </div>
          <div
            role="columnheader"
            className="text-foreground-lighter px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
          >
            Employed
          </div>
        </div>

        {/* Rows */}
        {rootAgents.map((agent) => renderAgent(agent))}

        {/* Skeleton rows only on initial load (not on refetch after toggle) */}
        {loading &&
          agentList.length === 0 &&
          Array.from({ length: skeletonRows ?? 4 }).map((_, i) => (
            <div
              key={`skel-${i}`}
              className="border-border grid items-center border-b"
              style={{ gridTemplateColumns: GRID_COLS }}
            >
              <div className="flex items-center gap-3 px-4 py-3.5">
                <div className="ml-6 flex items-center gap-3">
                  <div className="bg-surface-200 h-9 w-9 shrink-0 animate-pulse rounded-full" />
                  <div className="space-y-1.5">
                    <div className="bg-surface-200 h-3.5 w-20 animate-pulse rounded" />
                    <div className="bg-surface-200 h-3 w-32 animate-pulse rounded" />
                  </div>
                </div>
              </div>
              <div className="px-4 py-3.5">
                <div className="bg-surface-200 h-3.5 w-16 animate-pulse rounded" />
              </div>
              <div className="px-4 py-3.5">
                <div className="bg-surface-200 h-3.5 w-10 animate-pulse rounded" />
              </div>
              <div className="px-4 py-3.5">
                <div className="bg-surface-200 h-3.5 w-8 animate-pulse rounded" />
              </div>
              <div className="px-4 py-3.5">
                <div className="bg-surface-200 h-3.5 w-20 animate-pulse rounded" />
              </div>
              <div className="px-4 py-3.5">
                <div className="bg-surface-200 h-5 w-16 animate-pulse rounded-full" />
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page with Suspense boundary for useSearchParams
// ---------------------------------------------------------------------------

function AgentsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initialTab = searchParams.get('tab') ?? 'agents';
  const [tab, setTab] = useState(initialTab);
  const { enabled: showTeamTabs } = useFlag('team-advanced-tabs');
  const liveStatus = useLiveStatus();
  const { workspaceHref } = useWorkspaceHref();
  const [ericLastMessage, setEricLastMessage] = useState<number | null>(null);
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('You');
  const [mounted, setMounted] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const { activeWorkspace, userRole } = useWorkspace();
  const { canCreate, currentCount, limit } = useCanCreateAgent(activeWorkspace?.id);
  const { limits } = usePlan();
  const {
    agents: workspaceAgents,
    agentColors: workspaceColors,
    loading: agentsLoading,
    isPlatformOwner,
    refetch: refetchAgents,
  } = useAgents();

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem('eric_last_message_at');
    if (stored) setEricLastMessage(Number(stored));
  }, []);

  useEffect(() => {
    fetchJson<{
      first_name: string | null;
      display_name: string | null;
      avatar_url: string | null;
      email?: string;
    }>('/api/user/profile')
      .then((data) => {
        setUserAvatarUrl(data.avatar_url ?? null);
        setUserName(data.first_name || data.display_name || data.email?.split('@')[0] || 'You');
      })
      .catch(() => {
        /* Non-critical — falls back to defaults */
      });
  }, []);

  const isOwnerView = isPlatformOwner || userRole === 'owner';

  const handleTabChange = useCallback(
    (newTab: string) => {
      setTab(newTab);
      const params = new URLSearchParams(searchParams.toString());
      if (newTab === 'agents') {
        params.delete('tab');
      } else {
        params.set('tab', newTab);
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  const visibleTabs: PageTab[] = useMemo(() => {
    if (!showTeamTabs) return [];
    const tabs: PageTab[] = [
      { id: 'agents', label: 'Agents' },
      { id: 'activity', label: 'Activity' },
      { id: 'messages', label: 'Messages' },
    ];
    if (isOwnerView) {
      tabs.push({ id: 'delegations', label: 'Delegations' });
      tabs.push({ id: 'health', label: 'Health' });
    }
    return tabs;
  }, [showTeamTabs, isOwnerView]);
  const showUpgradeHint = !isOwnerView && limit !== null && currentCount >= limit;

  // Derive the user's lead agent (the one they created during onboarding, not a template seed)
  const userLeadAgent = useMemo(() => {
    const lead = workspaceAgents.find(
      (a) => a.type === 'ai' && !CORE_AGENT_IDS.has(a.id) && (a.is_active ?? true),
    );
    if (!lead) return null;
    const color = workspaceColors[lead.id]?.hex ?? '#3DD68C';
    return { agent_id: lead.id, display_name: lead.name, color, avatar_url: lead.icon ?? null };
  }, [workspaceAgents, workspaceColors]);

  // Build the agent roster: Lead agents (depth 1) → Subagents (depth 2)
  const { teamRoster, teamColors } = useMemo(() => {
    const _userEntry: Agent = {
      id: '__user__',
      name: userName,
      role: 'Owner',
      type: 'human',
      status: 'standby',
      description: '',
      parameters: {},
      activeProfile: '—',
      depth: 0,
      permissions: [],
    };
    const colors = {
      ...workspaceColors,
      __user__: {
        hex: '#56CCF2',
        text: 'text-sky-400',
        bg: 'bg-sky-400',
        border: 'border-sky-400',
        ring: 'ring-sky-400/60',
      },
    };
    return { teamRoster: workspaceAgents, teamColors: colors };
  }, [userName, workspaceAgents, workspaceColors]);

  return (
    <div className="flex min-h-full flex-col">
      <style>{`
        @keyframes rowShimmer {
          0%   { background-position: 100% center; }
          100% { background-position: 0% center; }
        }
        .row-working {
          background: linear-gradient(
            90deg,
            transparent 33%,
            color-mix(in srgb, var(--agent-shimmer-color, #34B27B) 7%, transparent) 50%,
            transparent 67%
          );
          background-size: 300% 100%;
          animation: rowShimmer 2.5s ease-in-out infinite alternate;
        }
      `}</style>

      <PageActionBar>
        <div className="flex items-center gap-2">
          <span className="text-foreground text-xl font-medium">Agents</span>
          {/* Agent count indicator for non-platform workspaces */}
          {!isOwnerView && limit !== null && (
            <span className="text-foreground-lighter text-xs tabular-nums">
              {currentCount}/{limit} agents
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showUpgradeHint && (
            <a
              href={workspaceHref('/settings?tab=billing')}
              className="text-foreground-lighter hover:text-foreground text-xs underline underline-offset-2 transition-colors"
            >
              Upgrade plan for more agents
            </a>
          )}
          <Button size="sm" asChild>
            <a href={workspaceHref('/agents/marketplace')}>
              <Plus size={14} className="mr-1.5" />
              Add Agent
            </a>
          </Button>
        </div>
      </PageActionBar>

      <AgentLeadWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onComplete={() => {
          setWizardOpen(false);
          refetchAgents();
        }}
        workspaceId={activeWorkspace?.id}
      />

      <TeamTemplatePicker
        open={templatePickerOpen}
        onClose={() => setTemplatePickerOpen(false)}
        onComplete={() => {
          setTemplatePickerOpen(false);
          refetchAgents();
        }}
        workspaceId={activeWorkspace?.id}
        userLeadAgent={userLeadAgent}
      />

      {visibleTabs.length > 0 && (
        <PageTabs tabs={visibleTabs} active={tab} onChange={handleTabChange} />
      )}

      <div className="p-6">
        {!mounted ? null : (
          <>
            {tab === 'agents' && (
              <AgentRosterTab
                agents={teamRoster}
                agentColors={teamColors}
                liveStatus={liveStatus}
                ericLastMessage={ericLastMessage}
                userAvatarUrl={userAvatarUrl}
                isPlatformView={isPlatformOwner && !activeWorkspace?.id}
                workspaceId={activeWorkspace?.id}
                onAgentsChange={refetchAgents}
                maxActiveAgents={limits.max_agents ?? undefined}
                loading={agentsLoading}
                skeletonRows={limit ?? 4}
              />
            )}

            {tab === 'activity' && showTeamTabs && <ActivityFeed />}

            {tab === 'messages' && showTeamTabs && <AgentMessages />}

            {tab === 'delegations' && showTeamTabs && isOwnerView && <DelegationFlowTab />}

            {tab === 'health' && showTeamTabs && isOwnerView && <AgentHealthDashboard />}
          </>
        )}
      </div>
    </div>
  );
}

export default function AgentsPage() {
  return (
    <Suspense>
      <AgentsPageInner />
    </Suspense>
  );
}
