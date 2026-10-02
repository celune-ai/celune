'use client';

import { useState } from 'react';
import { ChevronDown, Plus, Settings2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui/components/dropdown-menu';
import { useWorkspace } from '@/providers/workspace-provider';
import { CreateWorkspaceDialog } from '@/components/create-workspace-dialog';
import { useRouter } from 'next/navigation';
import type { Workspace } from '@repo/types';

/**
 * Determine workspace connection status.
 * Connected = repo linked + org has GitHub App installed.
 */
function getConnectionStatus(workspace: Workspace, orgHasInstallation: boolean): ConnectionStatus {
  // No repo linked = disconnected (grey dot)
  if (!workspace.repo_url) return 'disconnected';
  // Has repo but no org-level GitHub App installation = broken connection (red dot)
  if (!workspace.github_installation_id && !orgHasInstallation) return 'error';
  const meta = workspace.metadata;
  // Explicit error flag on connected repo = error (red dot)
  if (meta?.repo_connected === false) return 'error';
  if (meta?.repo_url && !meta?.repo_connected) return 'pending';
  return 'connected';
}

type ConnectionStatus = 'connected' | 'pending' | 'disconnected' | 'error';

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

function StatusDot({ status }: { status: ConnectionStatus }) {
  return (
    <span
      className={`${STATUS_COLORS[status]} inline-block h-2 w-2 shrink-0 rounded-full`}
      title={STATUS_LABELS[status]}
      aria-label={STATUS_LABELS[status]}
    />
  );
}

export function WorkspaceSwitcher({ compact }: { compact?: boolean }) {
  const { workspaces, activeWorkspace, setActiveWorkspace } = useWorkspace();
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);

  if (!activeWorkspace) return null;

  const orgHasInstallation = workspaces.some((w) => !!w.github_installation_id);
  const status = getConnectionStatus(activeWorkspace, orgHasInstallation);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`text-foreground flex w-full cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3.5 py-1.5 text-sm transition-colors hover:bg-black/40 ${
              compact ? 'min-w-0' : ''
            }`}
            aria-label="Switch workspace"
          >
            <StatusDot status={status} />
            <span className="min-w-0 flex-1 truncate text-left font-medium">
              {activeWorkspace.name}
            </span>
            <ChevronDown
              size={12}
              className="text-foreground-lighter shrink-0"
              aria-hidden="true"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="start"
          sideOffset={16}
          className="w-56 rounded border-white/10 bg-[#141414]"
        >
          {/* All workspaces */}
          <DropdownMenuLabel className="text-foreground-lighter text-xs">
            Workspaces
          </DropdownMenuLabel>
          {workspaces.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              onSelect={() => setActiveWorkspace(workspace)}
              className={`group flex cursor-pointer items-center gap-2 ${
                workspace.id === activeWorkspace.id ? 'bg-white/[0.08]' : ''
              }`}
            >
              <StatusDot status={getConnectionStatus(workspace, orgHasInstallation)} />
              <span className="flex-1 truncate">{workspace.name}</span>
              <button
                type="button"
                className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/10 focus-visible:opacity-100 max-sm:opacity-50"
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/${workspace.slug ?? workspace.id}/workspace-settings`);
                }}
                aria-label={`Settings for ${workspace.name}`}
              >
                <Settings2 size={13} className="text-foreground-lighter" />
              </button>
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setCreateOpen(true)}
            className="text-foreground-lighter flex cursor-pointer items-center gap-1.5 text-sm font-semibold"
          >
            <Plus size={14} className="shrink-0" aria-hidden="true" />
            Add Workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
