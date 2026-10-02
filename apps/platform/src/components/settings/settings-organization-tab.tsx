'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Trash2, ExternalLink, AlertTriangle, CircleHelp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { Label } from '@repo/ui/components/label';
import { Switch } from '@repo/ui/components/switch';
import { Textarea } from '@repo/ui/components/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@repo/ui/components/dialog';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import { GitHubAccountsCard } from './github-accounts-card';
import { SettingsCard } from './settings-shared';
import { useFlag } from '@/hooks/use-flags';
import type { Workspace } from '@repo/types';

function WorkspaceRow({
  workspace,
  onDelete,
  canDelete = true,
}: {
  workspace: Workspace;
  onDelete: (ws: Workspace) => void;
  canDelete?: boolean;
}) {
  const hasGithub = !!workspace.repo_url;
  return (
    <div className="border-border flex items-center justify-between border-b px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-3">
        <span
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${hasGithub ? 'bg-brand' : 'bg-border-strong'}`}
          title={hasGithub ? 'Connected' : 'No repo'}
        />
        <div>
          <p className="text-foreground text-sm font-medium">{workspace.name}</p>
          {workspace.repo_url && (
            <p className="text-foreground-muted text-xs">
              {workspace.repo_url.replace('https://github.com/', '')}
            </p>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-20"
        onClick={() => onDelete(workspace)}
        disabled={!canDelete}
      >
        <Trash2 size={14} />
      </Button>
    </div>
  );
}

export function SettingsOrganizationTab({ isOwner }: { isOwner: boolean }) {
  const { activeWorkspace, workspaces, refreshWorkspaces } = useWorkspace();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Delete workspace state — double confirmation
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Feature flags
  const { enabled: showAgentSettings } = useFlag('org-agent-settings');
  const { enabled: showIdeConnections } = useFlag('org-ide-connections');

  // Org-level settings
  const [reuseAgents, setReuseAgents] = useState(true);
  const [reuseAgentsLoading, setReuseAgentsLoading] = useState(true);

  // Agent behavior settings (org-wide, stored in workspace metadata)
  const [autoOpenUrls, setAutoOpenUrls] = useState(true);

  const allWorkspaces = workspaces;

  useEffect(() => {
    if (!activeWorkspace) return;
    setName(activeWorkspace.name ?? '');
    setDescription(activeWorkspace.description ?? '');
  }, [activeWorkspace]);

  // Re-fetch workspaces when user returns from GitHub auth tab
  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState === 'visible') {
      refreshWorkspaces();
    }
  }, [refreshWorkspaces]);

  useEffect(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [handleVisibilityChange]);

  // Fetch org-level settings (includes auto_open_urls and reuse_agents)
  useEffect(() => {
    setReuseAgentsLoading(true);
    fetchJson<{ reuse_agents_across_workspaces: boolean; auto_open_urls: boolean }>(
      apiUrl('/api/org/settings'),
    )
      .then((data) => {
        setReuseAgents(data.reuse_agents_across_workspaces);
        setAutoOpenUrls(data.auto_open_urls);
      })
      .catch(() => {
        // Non-fatal — toggles stay at defaults
      })
      .finally(() => {
        setReuseAgentsLoading(false);
      });
  }, []);

  if (!activeWorkspace) return null;

  async function handleSave() {
    if (!activeWorkspace) return;
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      toast.error('Name must be at least 2 characters');
      return;
    }
    setSaving(true);
    try {
      await fetchJson(apiUrl(`/api/workspaces/${activeWorkspace.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || null,
        }),
      });
      await refreshWorkspaces();
      toast.success('Organization updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  }

  async function handleReuseAgentsChange(checked: boolean) {
    const prev = reuseAgents;
    setReuseAgents(checked);
    try {
      await fetchJson(apiUrl('/api/org/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reuse_agents_across_workspaces: checked }),
      });
      toast.success(
        checked ? 'New workspaces will inherit agents' : 'New workspaces will use default agents',
      );
    } catch (err) {
      setReuseAgents(prev);
      toast.error(err instanceof Error ? err.message : 'Failed to update setting');
    }
  }

  async function handleToggleAutoOpen(checked: boolean) {
    const prev = autoOpenUrls;
    setAutoOpenUrls(checked);
    try {
      await fetchJson(apiUrl('/api/org/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_open_urls: checked }),
      });
      toast.success(checked ? 'Auto-open URLs enabled' : 'Auto-open URLs disabled');
    } catch (err) {
      setAutoOpenUrls(prev);
      toast.error(err instanceof Error ? err.message : 'Failed to save setting');
    }
  }

  function openDelete(ws: Workspace) {
    setDeleteTarget(ws);
    setDeleteStep(1);
    setDeleteConfirmName('');
  }

  function closeDelete() {
    setDeleteTarget(null);
    setDeleteStep(1);
    setDeleteConfirmName('');
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetchJson(apiUrl(`/api/workspaces/${deleteTarget.id}`), {
        method: 'DELETE',
      });
      closeDelete();
      toast.success(`${deleteTarget.name} deleted`);
      await refreshWorkspaces();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete workspace');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      {/* Organization Details */}
      <SettingsCard
        footer={
          name.trim() !== (activeWorkspace?.name ?? '') ||
          description.trim() !== (activeWorkspace?.description ?? '') ? (
            <div className="flex w-full items-center justify-end">
              <Button size="sm" onClick={handleSave} disabled={saving || name.trim().length < 2}>
                {saving ? (
                  <>
                    <Loader2 size={14} className="mr-1.5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save'
                )}
              </Button>
            </div>
          ) : undefined
        }
      >
        <h3 className="mb-1 text-base font-semibold">Organization Details</h3>
        <p className="text-foreground-muted mb-5 text-sm">
          Your organization is the top-level container for all workspaces.
        </p>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Name</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-description">Description</Label>
            <Textarea
              id="org-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder=""
              rows={3}
            />
          </div>
        </div>
      </SettingsCard>

      {/* GitHub Accounts — org-level installation management */}
      <GitHubAccountsCard isOwner={isOwner} />

      {/* Agent Settings — behind feature flag */}
      {showAgentSettings && (
        <SettingsCard>
          <h3 className="mb-1 text-base font-semibold">Agent Settings</h3>
          <p className="text-foreground-muted mb-5 text-sm">
            Control how agents behave across this organization.
          </p>

          <div className="border-border flex items-center justify-between border-b py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm">Auto-open URLs</span>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <CircleHelp size={14} className="text-foreground-muted" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs text-xs">
                    Allow agents to navigate you to pages in the app during chat conversations.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-foreground-muted text-sm">
                {autoOpenUrls ? 'Enabled' : 'Disabled'}
              </span>
              <Switch checked={autoOpenUrls} onCheckedChange={handleToggleAutoOpen} />
            </div>
          </div>

          <div className="border-border flex items-center justify-between py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm">Reuse agents across workspaces</span>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <CircleHelp size={14} className="text-foreground-muted" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs text-xs">
                    When enabled, new workspaces inherit the agent roster from your main workspace
                    instead of getting fresh default agents. Workspace admins can still modify
                    agents after creation.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-foreground-muted text-sm">
                {reuseAgentsLoading ? '...' : reuseAgents ? 'Enabled' : 'Disabled'}
              </span>
              <Switch
                checked={reuseAgents}
                onCheckedChange={handleReuseAgentsChange}
                disabled={reuseAgentsLoading}
              />
            </div>
          </div>
        </SettingsCard>
      )}

      {/* IDE Connection Scope — behind feature flag */}
      {showIdeConnections && (
        <SettingsCard>
          <h3 className="mb-1 text-base font-semibold">IDE Connections</h3>
          <p className="text-foreground-muted mb-5 text-sm">
            Control how IDE and CLI connections are scoped across this organization.
          </p>

          <div className="border-border flex items-center justify-between py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm">Share IDE connections across workspaces</span>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <CircleHelp size={14} className="text-foreground-muted" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs text-xs">
                    When enabled (default), a user&apos;s IDE connection works across all workspaces
                    in this organization. When disabled, each workspace requires its own connection.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-foreground-muted text-sm">Enabled</span>
              <Switch checked={true} disabled aria-label="IDE connection scope (coming soon)" />
            </div>
          </div>

          <p className="text-foreground-muted mt-2 text-xs italic">
            Workspace-scoped IDE connections coming soon. Organization-wide is the default.
          </p>
        </SettingsCard>
      )}

      {/* Workspaces List */}
      <SettingsCard>
        <h3 className="mb-1 text-base font-semibold">Workspaces</h3>
        <p className="text-foreground-muted mb-5 text-sm">
          {allWorkspaces.length === 0
            ? 'No workspaces yet. Create one from the sidebar.'
            : `${allWorkspaces.length} workspace${allWorkspaces.length === 1 ? '' : 's'} in this organization.`}
        </p>
        {allWorkspaces.length > 0 && (
          <div className="border-border overflow-hidden rounded-lg border">
            {allWorkspaces.map((ws) => (
              <WorkspaceRow
                key={ws.id}
                workspace={ws}
                onDelete={openDelete}
                canDelete={allWorkspaces.length > 1}
              />
            ))}
          </div>
        )}
      </SettingsCard>

      {/* Delete Workspace Dialog — Double Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && closeDelete()}>
        <DialogContent className="sm:max-w-md">
          {deleteStep === 1 ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertTriangle size={18} className="text-destructive" />
                  Delete {deleteTarget?.name}?
                </DialogTitle>
                <DialogDescription>
                  This will permanently delete the workspace and <strong>all</strong> of its data
                  including tasks, projects, agent configs, API keys, and memory entries. This
                  action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={closeDelete}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={() => setDeleteStep(2)}>
                  I understand, continue
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertTriangle size={18} className="text-destructive" />
                  Final confirmation
                </DialogTitle>
                <DialogDescription>
                  Type <strong>{deleteTarget?.name}</strong> to permanently delete this workspace
                  and all associated data.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <Input
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  placeholder={deleteTarget?.name}
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeDelete} disabled={deleting}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleteConfirmName !== deleteTarget?.name || deleting}
                >
                  {deleting ? (
                    <>
                      <Loader2 size={14} className="mr-1.5 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    'Delete Forever'
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
