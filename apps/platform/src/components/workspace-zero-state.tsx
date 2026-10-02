'use client';

import { Github, GitBranch, ArrowRight, Users } from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import { apiUrl } from '@repo/db/api';
import { useWorkspace } from '@/providers/workspace-provider';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import type { UserRole } from '@/lib/roles';

/**
 * Whether the given role can manage integrations (owner or admin).
 */
function canManageIntegrations(role: UserRole | null): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * Zero-state shown when a workspace has no connected repository.
 *
 * - Owner/admin: guided GitHub connection flow
 * - Member/viewer: informational message to contact admin
 */
export function WorkspaceZeroState() {
  const { activeWorkspace, userRole } = useWorkspace();
  const { workspaceHref } = useWorkspaceHref();

  if (!activeWorkspace) return null;

  const hasInstallation = !!activeWorkspace.github_installation_id;
  const isAdmin = canManageIntegrations(userRole);

  if (isAdmin) {
    return <AdminZeroState hasInstallation={hasInstallation} />;
  }

  return <MemberZeroState />;
}

/**
 * Owner/admin zero-state: connect to GitHub flow.
 */
function AdminZeroState({ hasInstallation }: { hasInstallation: boolean }) {
  const { activeWorkspace } = useWorkspace();
  const { workspaceHref } = useWorkspaceHref();

  function handleGitHubInstall() {
    window.open(apiUrl(`/api/github/install?workspace_id=${activeWorkspace!.id}`), '_blank');
  }

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      {/* Icon cluster */}
      <div className="mx-auto mb-6 flex items-center justify-center gap-3">
        <div className="bg-surface-100 border-border flex h-12 w-12 items-center justify-center rounded-xl border">
          <GitBranch size={22} className="text-foreground-muted" strokeWidth={1.5} />
        </div>
        <div className="text-foreground-muted text-lg">+</div>
        <div className="bg-surface-100 border-border flex h-12 w-12 items-center justify-center rounded-xl border">
          <Github size={22} className="text-foreground-muted" strokeWidth={1.5} />
        </div>
      </div>

      <h2 className="text-foreground mb-2 text-xl font-semibold">
        Connect your repository to get started
      </h2>
      <p className="text-foreground-muted mx-auto mb-8 max-w-sm text-sm leading-relaxed">
        Link a GitHub repository to enable agent codebase context, branch management, PR workflows,
        and task-to-commit traceability.
      </p>

      {hasInstallation ? (
        /* GitHub App installed — direct to settings to pick a repo */
        <div className="space-y-3">
          <Button
            onClick={() => (window.location.href = workspaceHref('/workspace-settings'))}
            className="gap-2"
          >
            <Github size={16} />
            Select a Repository
          </Button>
          <p className="text-foreground-muted text-xs">
            Your GitHub App is connected. Choose a repository in workspace settings.
          </p>
        </div>
      ) : (
        /* No GitHub App — install it first */
        <div className="space-y-3">
          <Button onClick={handleGitHubInstall} className="gap-2">
            <Github size={16} />
            Connect to GitHub
          </Button>
          <p className="text-foreground-muted text-xs">
            Install the Celune GitHub App to connect your repositories.
          </p>
        </div>
      )}

      {/* Settings link */}
      <div className="mt-6 border-t border-white/5 pt-6">
        <a
          href={workspaceHref('/workspace-settings')}
          className="text-foreground-muted hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors"
        >
          Go to workspace settings
          <ArrowRight size={14} />
        </a>
      </div>
    </div>
  );
}

/**
 * Member/viewer zero-state: informational, no action buttons.
 */
function MemberZeroState() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      {/* Icon */}
      <div className="mx-auto mb-6 flex items-center justify-center">
        <div className="bg-surface-100 border-border flex h-14 w-14 items-center justify-center rounded-xl border">
          <Users size={24} className="text-foreground-muted" strokeWidth={1.5} />
        </div>
      </div>

      <h2 className="text-foreground mb-2 text-xl font-semibold">
        Your workspace isn&apos;t set up yet
      </h2>
      <p className="text-foreground-muted mx-auto max-w-sm text-sm leading-relaxed">
        A workspace admin needs to connect a repository before you can start working on projects.
        Reach out to your workspace admin to get things set up.
      </p>
    </div>
  );
}
