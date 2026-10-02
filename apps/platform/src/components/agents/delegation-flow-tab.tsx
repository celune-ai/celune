'use client';

import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AGENT_COLORS } from '@/lib/agents-data';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspaceApiParam } from '@/hooks/use-workspace-api-param';
import { useWorkspace } from '@/providers/workspace-provider';
import { CollectingZeroState } from '@/components/collecting-zero-state';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface DelegationTask {
  id: string;
  title: string;
  delegated_at: string;
}

interface DelegationEdge {
  from: string;
  to: string;
  count: number;
  tasks: DelegationTask[];
}

interface DelegationData {
  edges: DelegationEdge[];
  stats: Record<string, { delegated_out: number; received: number }>;
}

function AgentDot({ agent }: { agent: string }) {
  const color = AGENT_COLORS[agent]?.hex ?? '#888';
  return (
    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
  );
}

function AgentName({ agent }: { agent: string }) {
  const color = AGENT_COLORS[agent]?.hex ?? '#888';
  return (
    <span className="inline-flex items-center gap-1.5 font-medium" style={{ color }}>
      <AgentDot agent={agent} />
      {agent}
    </span>
  );
}

function DelegationZeroState() {
  return (
    <CollectingZeroState
      title="Delegation flow is building up"
      description="As your agents collaborate and hand off tasks, delegation patterns will appear here. This typically takes about a week of active usage."
    />
  );
}

export function DelegationFlowTab() {
  const [data, setData] = useState<DelegationData | null>(null);
  const [loading, setLoading] = useState(true);
  const wsParam = useWorkspaceApiParam();
  const { activeWorkspace } = useWorkspace();

  // Force zero state for workspaces less than 7 days old
  const isNewWorkspace =
    activeWorkspace?.created_at &&
    Date.now() - new Date(activeWorkspace.created_at).getTime() < SEVEN_DAYS_MS;

  useEffect(() => {
    if (!wsParam || isNewWorkspace) {
      setLoading(false);
      return;
    }
    fetchJson<DelegationData>(`/api/agents/delegations?${wsParam}`)
      .then(setData)
      .catch(() => {
        /* Handled by loading state — shows empty delegation view */
      })
      .finally(() => setLoading(false));
  }, [wsParam, isNewWorkspace]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="border-brand h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }

  if (isNewWorkspace || !data || data.edges.length === 0) {
    return <DelegationZeroState />;
  }

  const sortedEdges = [...data.edges].sort((a, b) => b.count - a.count);
  const maxCount = sortedEdges[0]?.count ?? 1;

  // Build agent summary sorted by total activity
  const agentSummary = Object.entries(data.stats)
    .map(([agent, stats]) => ({
      agent,
      ...stats,
      total: stats.delegated_out + stats.received,
    }))
    .sort((a, b) => b.total - a.total);

  return (
    <div className="space-y-6">
      <p className="text-foreground-lighter text-sm">
        Task delegation flow between agents. Thicker bars indicate more frequent handoffs.
      </p>

      {/* Agent summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {agentSummary.map(({ agent, delegated_out, received }) => (
          <div key={agent} className="border-border bg-surface-100/50 rounded-lg border p-3">
            <div className="mb-1.5">
              <AgentName agent={agent} />
            </div>
            <div className="text-foreground-lighter flex gap-3 text-xs">
              <span>{delegated_out} out</span>
              <span>{received} in</span>
            </div>
          </div>
        ))}
      </div>

      {/* Delegation edges table */}
      <div className="border-border overflow-hidden rounded-lg border text-sm">
        <div className="border-border bg-surface-100 grid grid-cols-[1fr_40px_1fr_60px_1fr] items-center gap-2 border-b px-4 py-3">
          <span className="text-foreground-lighter text-xs font-medium tracking-wider uppercase">
            From
          </span>
          <span />
          <span className="text-foreground-lighter text-xs font-medium tracking-wider uppercase">
            To
          </span>
          <span className="text-foreground-lighter text-right text-xs font-medium tracking-wider uppercase">
            Count
          </span>
          <span className="text-foreground-lighter text-xs font-medium tracking-wider uppercase">
            Flow
          </span>
        </div>

        {sortedEdges.map((edge) => {
          const widthPct = Math.max(10, (edge.count / maxCount) * 100);
          const fromColor = AGENT_COLORS[edge.from]?.hex ?? '#888';
          const toColor = AGENT_COLORS[edge.to]?.hex ?? '#888';

          return (
            <div
              key={`${edge.from}->${edge.to}`}
              className="border-border grid grid-cols-[1fr_40px_1fr_60px_1fr] items-center gap-2 border-b px-4 py-3 last:border-b-0"
            >
              <AgentName agent={edge.from} />
              <div className="flex justify-center">
                <ArrowRight className="text-foreground-lighter h-4 w-4" />
              </div>
              <AgentName agent={edge.to} />
              <span className="text-foreground text-right font-mono text-sm tabular-nums">
                {edge.count}
              </span>
              <div className="bg-surface-200 h-2 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${widthPct}%`,
                    background: `linear-gradient(90deg, ${fromColor}, ${toColor})`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent delegations */}
      {sortedEdges.some((e) => e.tasks.length > 0) && (
        <div className="space-y-2">
          <h3 className="text-foreground text-sm font-medium">Recent Handoffs</h3>
          <div className="border-border divide-border divide-y rounded-lg border text-sm">
            {sortedEdges.flatMap((edge) =>
              edge.tasks.map((task) => (
                <div key={task.id} className="flex items-center gap-3 px-4 py-2.5">
                  <AgentDot agent={edge.from} />
                  <ArrowRight className="text-foreground-lighter h-3 w-3 shrink-0" />
                  <AgentDot agent={edge.to} />
                  <span className="text-foreground truncate">{task.title}</span>
                  {task.delegated_at && (
                    <span className="text-foreground-lighter ml-auto shrink-0 text-xs">
                      {new Date(task.delegated_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              )),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
