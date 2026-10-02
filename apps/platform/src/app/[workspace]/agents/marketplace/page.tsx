'use client';

import { useState, useMemo, useEffect } from 'react';
import { Search, ChevronRight, ChevronDown, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { PageActionBar } from '@/components/page-action-bar';
import { AgentMarketplaceCard } from '@/components/agents/agent-marketplace-card';
import { AgentDetailDrawer } from '@/components/agents/agent-detail-drawer';
import { useWorkspace } from '@/providers/workspace-provider';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';
import type { MarketplaceAgent, TeamCategory } from '@repo/db/team-templates';
import { TEAM_CATEGORIES } from '@repo/db/team-templates';

interface AgentWithStatus extends MarketplaceAgent {
  employed: boolean;
  is_active: boolean;
}

interface MarketplaceData {
  agents: AgentWithStatus[];
  categories: { category: TeamCategory; label: string; count: number }[];
  limits: { max: number; current: number };
}

export default function AgentMarketplacePage() {
  const { activeWorkspace } = useWorkspace();
  const { workspaceHref } = useWorkspaceHref();
  const workspaceId = activeWorkspace?.id;

  const [data, setData] = useState<MarketplaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | TeamCategory>('all');
  const [selectedAgent, setSelectedAgent] = useState<AgentWithStatus | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Fetch marketplace data
  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    fetchJson<MarketplaceData>(apiUrl(`/api/agents/marketplace?workspace_id=${workspaceId}`))
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  const refetch = () => {
    if (!workspaceId) return;
    fetchJson<MarketplaceData>(apiUrl(`/api/agents/marketplace?workspace_id=${workspaceId}`))
      .then(setData)
      .catch(() => {});
  };

  // Filter agents
  const filtered = useMemo(() => {
    if (!data) return [];
    return data.agents.filter((agent) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !agent.display_name.toLowerCase().includes(q) &&
          !agent.role.toLowerCase().includes(q) &&
          !agent.description.toLowerCase().includes(q)
        )
          return false;
      }
      if (categoryFilter !== 'all' && agent.category !== categoryFilter) return false;
      return true;
    });
  }, [data, searchQuery, categoryFilter]);

  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<string, AgentWithStatus[]> = {};
    for (const agent of filtered) {
      const cat = agent.category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(agent);
    }
    return groups;
  }, [filtered]);

  const canEmploy = data ? data.limits.current < data.limits.max : false;

  return (
    <div className="flex min-h-full flex-col">
      <PageActionBar>
        <div className="flex items-center gap-2">
          {/* Breadcrumb */}
          <Link
            href={workspaceHref('/agents')}
            className="text-foreground-lighter hover:text-foreground flex items-center gap-1 text-sm transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Team
          </Link>
          <ChevronRight className="text-foreground-muted h-3.5 w-3.5" />
          <span className="text-foreground text-xl font-medium">Add Agents</span>
          {data && (
            <span className="text-foreground-lighter text-sm tabular-nums">
              {data.agents.length} available &middot; {data.limits.current}/{data.limits.max}{' '}
              employed
            </span>
          )}
        </div>
      </PageActionBar>

      <div className="space-y-6 p-6">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="text-foreground-lighter pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search agents..."
              className="border-border bg-surface-100 text-foreground placeholder:text-foreground-muted hover:border-border-strong focus-visible:border-brand focus-visible:ring-brand/25 w-56 rounded-md border py-1.5 pr-3 pl-8 text-xs transition-colors outline-none focus-visible:ring-2"
            />
          </div>

          {/* Category filter */}
          <div className="relative">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as 'all' | TeamCategory)}
              className="border-border bg-surface-100 text-foreground-light hover:border-border-strong focus-visible:border-brand focus-visible:ring-brand/25 appearance-none rounded-md border py-1.5 pr-7 pl-3 text-xs transition-colors outline-none focus-visible:ring-2"
            >
              <option value="all">All categories</option>
              {data?.categories.map((c) => (
                <option key={c.category} value={c.category}>
                  {c.label} ({c.count})
                </option>
              ))}
            </select>
            <ChevronDown className="text-foreground-lighter pointer-events-none absolute top-1/2 right-2 h-3 w-3 -translate-y-1/2" />
          </div>

          {/* Status pills */}
          <div className="flex items-center gap-1.5">
            {(['all', 'employed', 'available'] as const).map((filter) => {
              const count =
                filter === 'all'
                  ? (data?.agents.length ?? 0)
                  : filter === 'employed'
                    ? (data?.agents.filter((a) => a.employed).length ?? 0)
                    : (data?.agents.filter((a) => !a.employed).length ?? 0);
              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => {
                    // Simple status filter via search/category reset
                  }}
                  className="border-border text-foreground-lighter hover:border-border-strong hover:text-foreground rounded-full border px-3 py-1 text-xs font-medium transition-colors"
                >
                  {filter === 'all'
                    ? `All (${count})`
                    : `${filter.charAt(0).toUpperCase() + filter.slice(1)} (${count})`}
                </button>
              );
            })}
          </div>
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div
            role="status"
            aria-busy="true"
            aria-label="Loading agents"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="border-border bg-surface-75 flex flex-col items-start gap-3 rounded-lg border p-4"
              >
                {/* Avatar + name */}
                <div className="flex w-full items-center gap-3">
                  <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-white/[0.06]" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-3.5 w-24 animate-pulse rounded bg-white/[0.06]" />
                    <div className="h-3 w-16 animate-pulse rounded bg-white/[0.06]" />
                  </div>
                </div>
                {/* Description */}
                <div className="w-full space-y-1.5">
                  <div className="h-3 w-full animate-pulse rounded bg-white/[0.06]" />
                  <div className="h-3 w-3/4 animate-pulse rounded bg-white/[0.06]" />
                </div>
                {/* Footer badge */}
                <div className="flex items-center gap-2">
                  <div className="h-4 w-16 animate-pulse rounded-full bg-white/[0.06]" />
                  <div className="h-3 w-10 animate-pulse rounded bg-white/[0.06]" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Agent grid grouped by category */}
        {!loading &&
          Object.entries(grouped).map(([cat, agents]) => {
            const catMeta = TEAM_CATEGORIES[cat as TeamCategory];
            return (
              <section key={cat}>
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="text-foreground-lighter text-xs font-medium tracking-wide uppercase">
                    {catMeta?.label ?? cat}
                  </h2>
                  <span className="text-foreground-muted text-xs">({agents.length})</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {agents.map((agent) => (
                    <AgentMarketplaceCard
                      key={agent.agent_id}
                      agent={agent}
                      onClick={() => {
                        setSelectedAgent(agent);
                        setDrawerOpen(true);
                      }}
                      locked={!canEmploy}
                    />
                  ))}
                </div>
              </section>
            );
          })}

        {/* Empty state */}
        {!loading && filtered.length === 0 && (
          <div className="py-20 text-center">
            <p className="text-foreground-lighter text-sm">
              No agents match your search. Try a different query or category.
            </p>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      <AgentDetailDrawer
        open={drawerOpen}
        agent={selectedAgent}
        onClose={() => setDrawerOpen(false)}
        onEmployed={refetch}
        workspaceId={workspaceId}
        canEmploy={canEmploy}
      />
    </div>
  );
}
