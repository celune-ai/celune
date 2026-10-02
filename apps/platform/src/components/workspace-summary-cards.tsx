'use client';

import { useEffect, useState } from 'react';
import { useWorkspace } from '@/providers/workspace-provider';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import type { Workspace } from '@repo/types';
import { FolderKanban, KanbanSquare, Clock } from 'lucide-react';

interface WorkspaceStats {
  workspace: Workspace;
  taskCount: number;
  projectCount: number;
  lastActivity: string | null;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

type ConnectionStatus = 'connected' | 'pending' | 'disconnected' | 'error';

function getConnectionStatus(workspace: Workspace, orgHasInstallation: boolean): ConnectionStatus {
  if (!workspace.repo_url) return 'disconnected';
  if (!workspace.github_installation_id && !orgHasInstallation) return 'error';
  const meta = workspace.metadata;
  if (meta?.repo_connected === false) return 'error';
  if (meta?.repo_url && !meta?.repo_connected) return 'pending';
  return 'connected';
}

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  connected: 'bg-emerald-500',
  pending: 'bg-amber-400',
  disconnected: 'bg-zinc-500',
  error: 'bg-red-500',
};

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  pending: 'Setup in progress',
  disconnected: 'No repository',
  error: 'Connection error',
};

/**
 * Shows a grid of workspace summary cards on the Main dashboard.
 * Each card shows task count, project count, and last activity for a child workspace.
 */
export function WorkspaceSummaryCards() {
  const { workspaces, activeWorkspace, setActiveWorkspace } = useWorkspace();
  const [stats, setStats] = useState<WorkspaceStats[]>([]);
  const [loading, setLoading] = useState(true);

  const childWorkspaces = workspaces.filter((w) => !w.is_default);
  const orgHasInstallation = workspaces.some((w) => !!w.github_installation_id);

  useEffect(() => {
    if (!activeWorkspace?.is_default || childWorkspaces.length === 0) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    Promise.all(
      childWorkspaces.map(async (ws) => {
        const [tasks, projects] = await Promise.all([
          fetchJson<unknown[]>(apiUrl(`/api/tasks?workspace_id=${ws.id}&limit=1000`)).catch(
            () => [],
          ),
          fetchJson<unknown[]>(apiUrl(`/api/projects?workspace_id=${ws.id}`)).catch(() => []),
        ]);

        const taskList = Array.isArray(tasks) ? tasks : [];
        const projectList = Array.isArray(projects) ? projects : [];

        // Find most recent activity from task updated_at
        const lastActivity = taskList.reduce<string | null>((latest, t) => {
          const updated = (t as { updated_at?: string }).updated_at;
          if (!updated) return latest;
          return !latest || updated > latest ? updated : latest;
        }, null);

        return {
          workspace: ws,
          taskCount: taskList.length,
          projectCount: projectList.length,
          lastActivity,
        } satisfies WorkspaceStats;
      }),
    ).then((results) => {
      if (!cancelled) {
        setStats(results);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.is_default, activeWorkspace?.id]);

  if (!activeWorkspace?.is_default || childWorkspaces.length === 0) return null;

  if (loading) {
    return (
      <div className="mt-8">
        <h2 className="text-foreground mb-4 text-sm font-medium">Workspaces</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {childWorkspaces.map((ws) => (
            <div
              key={ws.id}
              className="border-border bg-surface-75 h-24 animate-pulse rounded-lg border"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <h2 className="text-foreground mb-4 text-sm font-medium">Workspaces</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map(({ workspace, taskCount, projectCount, lastActivity }) => {
          const status = getConnectionStatus(workspace, orgHasInstallation);
          return (
            <button
              key={workspace.id}
              type="button"
              onClick={() => setActiveWorkspace(workspace)}
              className="border-border bg-surface-75 hover:bg-surface-100 flex cursor-pointer flex-col gap-3 rounded-lg border p-4 text-left transition-colors"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`${STATUS_COLORS[status]} inline-block h-2 w-2 shrink-0 rounded-full`}
                  title={STATUS_LABELS[status]}
                />
                <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
                  {workspace.name}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-foreground-muted flex items-center gap-1 text-xs">
                  <KanbanSquare size={12} />
                  {taskCount} tasks
                </span>
                <span className="text-foreground-muted flex items-center gap-1 text-xs">
                  <FolderKanban size={12} />
                  {projectCount} projects
                </span>
                {lastActivity && (
                  <span className="text-foreground-muted flex items-center gap-1 text-xs">
                    <Clock size={12} />
                    {timeAgo(lastActivity)}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
