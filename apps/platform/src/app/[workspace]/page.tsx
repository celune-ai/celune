'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePlan } from '@/hooks/use-plan';
import { PLAN_LABELS } from '@repo/types';
import { useWorkspace } from '@/providers/workspace-provider';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import {
  FolderKanban,
  KanbanSquare,
  Bot,
  ArrowRight,
  Building2,
  Sparkles,
  Brain,
} from 'lucide-react';
import { WorkspaceSummaryCards } from '@/components/workspace-summary-cards';
import { WorkspaceSeedingBanner } from '@/components/workspace-seeding-banner';
import { GettingStartedGuide } from '@/components/getting-started-guide';

interface QuickStats {
  task_count: number;
  project_count: number;
  agent_count: number;
  skill_count: number;
  memory_count: number;
}

function CustomerHome() {
  const { workspaceHref } = useWorkspaceHref();
  const { activeWorkspace, isMainWorkspace } = useWorkspace();
  const { plan, hasFeature } = usePlan();
  const [stats, setStats] = useState<QuickStats | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Refresh stats when background seeding completes
  const handleSeedingComplete = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    let cancelled = false;

    Promise.all([
      fetchJson<{ count: number }>(
        apiUrl(`/api/tasks?workspace_id=${activeWorkspace.id}&count_only=true`),
      ).catch(() => null),
      fetchJson<unknown[]>(apiUrl(`/api/projects?workspace_id=${activeWorkspace.id}`)).catch(
        () => [],
      ),
      fetchJson<unknown[]>(apiUrl(`/api/agents/configs?workspace_id=${activeWorkspace.id}`)).catch(
        () => [],
      ),
      fetchJson<{ data: unknown[] }>(
        apiUrl(`/api/brain/manifest?workspace_id=${activeWorkspace.id}`),
      )
        .then((res) => res?.data ?? [])
        .catch(() => []),
      fetchJson<{ total?: number }>(
        apiUrl(`/api/memory/stats?workspace_id=${activeWorkspace.id}`),
      ).catch(() => null),
    ]).then(([taskCount, projects, agents, skills, memoryStats]) => {
      if (cancelled) return;
      setStats({
        task_count: taskCount?.count ?? 0,
        project_count: Array.isArray(projects) ? projects.length : 0,
        agent_count: Array.isArray(agents) ? agents.length : 0,
        skill_count: Array.isArray(skills) ? skills.length : 0,
        memory_count: (memoryStats as { total?: number } | null)?.total ?? 0,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.id, refreshKey]);

  const cards = [
    {
      label: 'Projects',
      value:
        stats !== null ? (
          stats.project_count
        ) : (
          <span className="bg-surface-200 inline-block h-5 w-10 animate-pulse rounded" />
        ),
      icon: FolderKanban,
      href: workspaceHref('/projects'),
      always: true,
    },
    {
      label: 'Tasks',
      value:
        stats !== null ? (
          stats.task_count
        ) : (
          <span className="bg-surface-200 inline-block h-5 w-10 animate-pulse rounded" />
        ),
      icon: KanbanSquare,
      href: workspaceHref('/tasks'),
      always: true,
    },
    {
      label: 'Team',
      value:
        stats !== null ? (
          stats.agent_count
        ) : (
          <span className="bg-surface-200 inline-block h-5 w-10 animate-pulse rounded" />
        ),
      icon: Bot,
      href: workspaceHref('/agents'),
      always: true,
    },
    {
      label: 'Skills',
      value:
        stats !== null ? (
          stats.skill_count
        ) : (
          <span className="bg-surface-200 inline-block h-5 w-10 animate-pulse rounded" />
        ),
      icon: Sparkles,
      href: workspaceHref('/skills'),
      always: true,
    },
    {
      label: 'Memories',
      value:
        stats !== null ? (
          stats.memory_count
        ) : (
          <span className="bg-surface-200 inline-block h-5 w-10 animate-pulse rounded" />
        ),
      icon: Brain,
      href: workspaceHref('/memory'),
      always: true,
    },
  ];

  const visibleCards = cards;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2">
          {isMainWorkspace && <Building2 size={22} className="text-brand shrink-0" />}
          <h1 className="text-foreground truncate text-2xl font-semibold">
            {activeWorkspace?.name ?? 'Workspace'}
          </h1>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          {isMainWorkspace
            ? 'Organization overview — analytics across all workspaces'
            : PLAN_LABELS[plan]}
        </p>
      </div>

      {/* Getting Started Guide */}
      <div className="mb-6">
        <GettingStartedGuide />
      </div>

      {/* Background seeding indicator — shows when workspace was just created */}
      <WorkspaceSeedingBanner onSeedingComplete={handleSeedingComplete} />

      {/* Quick stats row */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {visibleCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              href={card.href}
              className="border-border bg-surface-75 hover:bg-surface-100 flex flex-col items-start gap-3 rounded-lg border p-4 transition-colors"
            >
              <Icon size={20} className="text-muted-foreground" strokeWidth={1.5} />
              <div>
                <p className="text-foreground text-lg font-semibold">{card.value}</p>
                <p className="text-muted-foreground text-xs">{card.label}</p>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Child workspace summary cards (Main workspace only) */}
      {isMainWorkspace && <WorkspaceSummaryCards />}
    </div>
  );
}

export default function WorkspaceHome() {
  return <CustomerHome />;
}
