'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  Trash2,
  Github,
  ExternalLink,
  FolderOpen,
  Plus,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { Label } from '@repo/ui/components/label';
import { Textarea } from '@repo/ui/components/textarea';
import { Badge } from '@repo/ui/components/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@repo/ui/components/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@repo/ui/components/collapsible';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import { PageActionBar } from '@/components/page-action-bar';
import {
  SettingsCard,
  SettingsToggle,
  formatRepoUrl,
  formatConnectedDate,
} from '@/components/settings/settings-shared';
import type { Workspace, GitHubSettings } from '@repo/types';
import { GitHubRepoSelector } from '@/components/settings/github-repo-selector';

const DEFAULT_GH_SETTINGS: GitHubSettings = {
  pr_strategy: 'per_project',
  auto_pr: 'draft_on_push',
  branch_naming: {
    prefix: 'celune',
    separator: '/',
    include_assignee: true,
    slug_source: 'project_name',
  },
  default_reviewers: [],
  rebase_threshold_commits: 20,
  stale_pr_warning_days: 7,
  agent_code_context: true,
  auto_sync_on_push: true,
  webhook_events: false,
};

export default function WorkspaceSettingsPage() {
  const { activeWorkspace, workspaces, refreshWorkspaces } = useWorkspace();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Repo connection
  const [connectingRepo, setConnectingRepo] = useState(false);
  const [repoRefreshKey, setRepoRefreshKey] = useState(0);

  // Disconnect confirmation
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnectingRepo, setDisconnectingRepo] = useState(false);

  // Workspace delete state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  // GitHub settings (persisted to workspace.github_settings)
  const [ghSettings, setGhSettings] = useState<GitHubSettings>(DEFAULT_GH_SETTINGS);
  const [savingGh, setSavingGh] = useState(false);

  // Branch naming accordion
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Load github_settings from workspace on mount
  useEffect(() => {
    if (!activeWorkspace) return;
    const ws = activeWorkspace as Workspace & { github_settings?: GitHubSettings | null };
    if (ws.github_settings) {
      setGhSettings({ ...DEFAULT_GH_SETTINGS, ...ws.github_settings });
    }
  }, [activeWorkspace]);

  async function handleSaveGhSettings(updates: Partial<GitHubSettings>) {
    if (!activeWorkspace) return;
    const merged = { ...ghSettings, ...updates };
    setGhSettings(merged);
    setSavingGh(true);
    try {
      await fetchJson(apiUrl(`/api/workspaces/${activeWorkspace.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ github_settings: updates }),
      });
      await refreshWorkspaces();
      toast.success('GitHub settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSavingGh(false);
    }
  }

  useEffect(() => {
    if (!activeWorkspace) return;
    setName(activeWorkspace.name ?? '');
    setDescription(activeWorkspace.description ?? '');
  }, [activeWorkspace]);

  // Try to sync org-level GitHub installation to this workspace.
  const trySyncInstallation = useCallback(async () => {
    if (!activeWorkspace || activeWorkspace.github_installation_id) return;
    try {
      const res = await fetchJson<{ synced: boolean }>(apiUrl('/api/github/sync-installation'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: activeWorkspace.id }),
      });
      if (res.synced) {
        await refreshWorkspaces();
        toast.success('GitHub connection detected');
      }
    } catch {
      // Silently fail — user can manually reconnect
    }
  }, [activeWorkspace, refreshWorkspaces]);

  useEffect(() => {
    trySyncInstallation();
  }, [trySyncInstallation]);

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return;
      await trySyncInstallation();
      await refreshWorkspaces();
      // Force repo selector to re-fetch (user may have added new GitHub account)
      setRepoRefreshKey((k) => k + 1);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [trySyncInstallation, refreshWorkspaces]);

  if (!activeWorkspace) return null;

  const isDefault = activeWorkspace.is_default;
  const repoUrl = activeWorkspace.repo_url ?? null;
  const repoPath = activeWorkspace.repo_path ?? null;
  const repoConnectedAt = activeWorkspace.repo_connected_at ?? null;
  const repoProvider = activeWorkspace.repo_provider ?? 'github';
  // Org has GitHub connected if any workspace has an installation
  const hasInstallation =
    !!activeWorkspace.github_installation_id || workspaces.some((w) => !!w.github_installation_id);

  // GitHub connection status — healthy if repo linked + org has installation
  const githubHealthy = hasInstallation && !!repoUrl;
  const githubError =
    !!repoUrl && (!hasInstallation || activeWorkspace?.metadata?.repo_connected === false);

  const usedRepoUrls = workspaces
    .filter((w: Workspace) => w.id !== activeWorkspace.id && w.repo_url)
    .map((w: Workspace) => w.repo_url!);

  const platformMonorepoUrl = process.env.NEXT_PUBLIC_PLATFORM_REPO_URL ?? null;
  const isMonorepoPath =
    repoPath && repoPath !== '/' && platformMonorepoUrl && repoUrl?.includes(platformMonorepoUrl);

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
      toast.success('Workspace updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update workspace');
    } finally {
      setSaving(false);
    }
  }

  function handleGitHubInstall() {
    window.open(apiUrl(`/api/github/install?workspace_id=${activeWorkspace!.id}`), '_blank');
  }

  async function handleRepoSelect(repo: { html_url: string; default_branch: string }) {
    if (!activeWorkspace) return;
    setConnectingRepo(true);
    try {
      await fetchJson(apiUrl('/api/github/callback'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: activeWorkspace.id,
          repo_url: repo.html_url,
          default_branch: repo.default_branch,
        }),
      });
      await refreshWorkspaces();
      toast.success('Repository connected');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect repository');
    } finally {
      setConnectingRepo(false);
    }
  }

  async function handleDisconnectRepo() {
    if (!activeWorkspace) return;
    setDisconnectingRepo(true);
    try {
      await fetchJson(apiUrl(`/api/workspaces/${activeWorkspace.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_url: null }),
      });
      await refreshWorkspaces();
      toast.success('Repository disconnected');
      setDisconnectOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect repository');
    } finally {
      setDisconnectingRepo(false);
    }
  }

  async function handleDelete() {
    if (!activeWorkspace || isDefault) return;
    setDeleting(true);
    try {
      await fetchJson(apiUrl(`/api/workspaces/${activeWorkspace.id}`), {
        method: 'DELETE',
      });
      setDeleteOpen(false);
      toast.success('Workspace deleted');
      await refreshWorkspaces();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete workspace');
    } finally {
      setDeleting(false);
    }
  }

  const canDelete = deleteConfirm === activeWorkspace.name;

  return (
    <div className="flex min-h-full flex-col">
      <PageActionBar>
        <span className="text-foreground text-xl font-medium">{activeWorkspace.name} Settings</span>
      </PageActionBar>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-8">
          {/* Workspace Details Card */}
          <SettingsCard
            footer={
              name.trim() !== (activeWorkspace.name ?? '') ||
              description.trim() !== (activeWorkspace.description ?? '') ? (
                <div className="flex w-full items-center justify-between">
                  <p className="text-foreground-muted text-sm">
                    Used to identify your workspace across the platform.
                  </p>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saving || name.trim().length < 2}
                  >
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
            <h3 className="mb-1 text-base font-semibold">Workspace Details</h3>
            <p className="text-foreground-muted mb-5 text-sm">
              General information about this workspace.
            </p>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ws-name">Name</Label>
                <Input
                  id="ws-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  minLength={2}
                  maxLength={100}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ws-description">Description</Label>
                <Textarea
                  id="ws-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this workspace for?"
                  rows={3}
                />
              </div>
            </div>
          </SettingsCard>

          {/* Git Repository Card */}
          <SettingsCard>
            {repoUrl ? (
              <>
                <h3 className="mb-1 text-base font-semibold">Connected Git Repository</h3>
                <p className="text-foreground-muted mb-5 text-sm">
                  This workspace is linked to a codebase for agent context and GitHub sync.
                </p>

                {/* Connected repo row */}
                <div className="bg-surface-75 border-border mb-5 flex items-center justify-between rounded-lg border px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="bg-surface-200 flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
                        {repoProvider === 'github' ? (
                          <Github size={18} className="text-foreground" />
                        ) : (
                          <FolderOpen size={18} className="text-foreground" />
                        )}
                      </div>
                      <span
                        className={`absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full ${
                          githubError
                            ? 'bg-red-500'
                            : githubHealthy
                              ? 'bg-emerald-500'
                              : 'bg-zinc-500'
                        }`}
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <a
                          href={repoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-foreground hover:text-brand text-sm font-medium"
                        >
                          {formatRepoUrl(repoUrl)}
                          <ExternalLink size={11} className="ml-1.5 inline-block opacity-50" />
                        </a>
                        {isMonorepoPath && (
                          <Badge variant="outline" className="text-xs">
                            monorepo
                          </Badge>
                        )}
                      </div>
                      <p className="text-foreground-muted text-xs">
                        {isMonorepoPath && repoPath ? (
                          <span className="font-mono">/{repoPath}</span>
                        ) : repoConnectedAt ? (
                          formatConnectedDate(repoConnectedAt)
                        ) : (
                          'Connected'
                        )}
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setDisconnectOpen(true)}>
                    Disconnect
                  </Button>
                </div>

                {/* Connection error warning */}
                {githubError && (
                  <div className="bg-destructive/5 border-destructive/20 mb-5 flex items-start gap-2.5 rounded-lg border px-4 py-3">
                    <AlertTriangle size={15} className="text-destructive mt-0.5 shrink-0" />
                    <div>
                      <p className="text-foreground text-sm font-medium">GitHub connection error</p>
                      <p className="text-foreground-muted mt-0.5 text-xs">
                        {!hasInstallation
                          ? "The organization's GitHub App has been disconnected. Reconnect from organization settings to restore agent features."
                          : 'The repository connection has an error. Try disconnecting and reconnecting the repository.'}
                      </p>
                    </div>
                  </div>
                )}

                {/* Feature toggles */}
                <div>
                  <SettingsToggle
                    label="Agent Codebase Context"
                    description="Agents can read repository structure and files when handling tasks in this workspace."
                    checked={ghSettings.agent_code_context}
                    onCheckedChange={(v) => handleSaveGhSettings({ agent_code_context: v })}
                    disabled={savingGh}
                  />
                  <SettingsToggle
                    label="Auto-Sync on Push"
                    description="Automatically update the workspace context when new commits are pushed to the default branch."
                    checked={ghSettings.auto_sync_on_push}
                    onCheckedChange={(v) => handleSaveGhSettings({ auto_sync_on_push: v })}
                    disabled={savingGh}
                  />
                  <SettingsToggle
                    label="Webhook Events"
                    description="Receive webhook notifications for push, PR, and issue events from the connected repository."
                    checked={ghSettings.webhook_events}
                    onCheckedChange={(v) => handleSaveGhSettings({ webhook_events: v })}
                    disabled={savingGh}
                  />
                </div>

                {/* Advanced Settings — PR strategy + branch naming */}
                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="mt-6">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between py-2"
                      aria-expanded={advancedOpen}
                    >
                      <h4 className="text-sm font-semibold">Advanced Settings</h4>
                      <ChevronDown
                        size={16}
                        className={`text-foreground-muted shrink-0 transition-transform duration-200 ${
                          advancedOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-6 pt-3">
                      {/* PR Strategy */}
                      <div>
                        <h5 className="text-foreground-muted mb-3 text-xs font-medium tracking-wide uppercase">
                          Pull Request Strategy
                        </h5>
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">PR Grouping</Label>
                            <Select
                              value={ghSettings.pr_strategy}
                              onValueChange={(v) =>
                                handleSaveGhSettings({
                                  pr_strategy: v as GitHubSettings['pr_strategy'],
                                })
                              }
                            >
                              <SelectTrigger className="text-sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="per_project">
                                  One PR per project (recommended)
                                </SelectItem>
                                <SelectItem value="per_task">One PR per task</SelectItem>
                                <SelectItem value="manual">
                                  Manual — agents don&apos;t auto-create PRs
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-1.5">
                            <Label className="text-xs">Auto-Create PRs</Label>
                            <Select
                              value={ghSettings.auto_pr}
                              onValueChange={(v) =>
                                handleSaveGhSettings({
                                  auto_pr: v as GitHubSettings['auto_pr'],
                                })
                              }
                            >
                              <SelectTrigger className="text-sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="draft_on_push">
                                  Create draft PR on first push
                                </SelectItem>
                                <SelectItem value="ready_on_push">
                                  Create ready PR on first push
                                </SelectItem>
                                <SelectItem value="off">Off — create PRs manually</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="default-reviewers" className="text-xs">
                              Default Reviewers
                            </Label>
                            <Input
                              id="default-reviewers"
                              value={ghSettings.default_reviewers.join(', ')}
                              onChange={(e) => {
                                const reviewers = e.target.value
                                  .split(',')
                                  .map((r) => r.trim())
                                  .filter(Boolean);
                                setGhSettings((s) => ({ ...s, default_reviewers: reviewers }));
                              }}
                              onBlur={() =>
                                handleSaveGhSettings({
                                  default_reviewers: ghSettings.default_reviewers,
                                })
                              }
                              placeholder="e.g. octocat, janedoe"
                              className="text-sm"
                            />
                            <p className="text-foreground-muted text-xs">
                              Comma-separated GitHub usernames. Added to every PR automatically.
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Branch Naming */}
                      <div>
                        <h5 className="text-foreground-muted mb-3 text-xs font-medium tracking-wide uppercase">
                          Branch Naming
                        </h5>
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label htmlFor="branch-prefix" className="text-xs">
                                Branch Name Prefix
                              </Label>
                              <Input
                                id="branch-prefix"
                                value={ghSettings.branch_naming.prefix}
                                onChange={(e) =>
                                  setGhSettings((s) => ({
                                    ...s,
                                    branch_naming: {
                                      ...s.branch_naming,
                                      prefix: e.target.value,
                                    },
                                  }))
                                }
                                onBlur={() =>
                                  handleSaveGhSettings({
                                    branch_naming: ghSettings.branch_naming,
                                  })
                                }
                                className="text-sm"
                              />
                              <p className="text-foreground-muted text-xs">
                                Preview:{' '}
                                <code className="bg-surface-200 rounded px-1 py-0.5 text-xs">
                                  {ghSettings.branch_naming.prefix}
                                  {ghSettings.branch_naming.separator}
                                  {ghSettings.branch_naming.include_assignee
                                    ? 'assignee' + ghSettings.branch_naming.separator
                                    : ''}
                                  project-name
                                </code>
                              </p>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Separator</Label>
                              <Select
                                value={ghSettings.branch_naming.separator}
                                onValueChange={(v) =>
                                  handleSaveGhSettings({
                                    branch_naming: {
                                      ...ghSettings.branch_naming,
                                      separator: v,
                                    },
                                  })
                                }
                              >
                                <SelectTrigger className="text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="/">/</SelectItem>
                                  <SelectItem value="-">-</SelectItem>
                                  <SelectItem value="_">_</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <SettingsToggle
                            label="Include assignee in branch name"
                            description="Adds the agent or user name between the prefix and project slug."
                            checked={ghSettings.branch_naming.include_assignee}
                            onCheckedChange={(v) =>
                              handleSaveGhSettings({
                                branch_naming: {
                                  ...ghSettings.branch_naming,
                                  include_assignee: v,
                                },
                              })
                            }
                            disabled={savingGh}
                          />
                        </div>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </>
            ) : (
              <>
                <div className="mb-1 flex items-center justify-between">
                  <h3 className="text-base font-semibold">Connect a Git Repository</h3>
                  {hasInstallation && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-foreground-muted -mr-2 gap-2"
                      onClick={handleGitHubInstall}
                    >
                      <Plus size={14} />
                      Add Repository
                    </Button>
                  )}
                </div>
                <p className="text-foreground-muted mb-5 text-sm">
                  Link a repository to give agents codebase context for this workspace.
                </p>

                {hasInstallation ? (
                  <GitHubRepoSelector
                    key={`repos-${repoRefreshKey}`}
                    workspaceId={activeWorkspace.id}
                    hasInstallation={hasInstallation}
                    connectedRepoUrl={null}
                    usedRepoUrls={usedRepoUrls}
                    onSelect={handleRepoSelect}
                    onInstall={handleGitHubInstall}
                  />
                ) : (
                  <GitHubRepoSelector
                    workspaceId={activeWorkspace.id}
                    hasInstallation={false}
                    onSelect={handleRepoSelect}
                    onInstall={handleGitHubInstall}
                  />
                )}
              </>
            )}
          </SettingsCard>

          {/* Danger Zone Card */}
          {!isDefault && (
            <SettingsCard
              danger
              footer={
                <div className="flex w-full items-center justify-between">
                  <p className="text-foreground-muted text-sm">
                    This action is irreversible. Please be certain.
                  </p>
                  <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                    <Trash2 size={14} className="mr-1.5" />
                    Delete Workspace
                  </Button>
                </div>
              }
            >
              <h3 className="text-destructive mb-1 text-base font-semibold">Delete Workspace</h3>
              <p className="text-foreground-muted text-sm">
                Permanently delete <strong>{activeWorkspace.name}</strong> and all associated
                agents, tasks, API keys, and webhooks. This cannot be undone.
              </p>
            </SettingsCard>
          )}
        </div>
      </div>

      {/* Disconnect confirmation dialog */}
      <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Disconnect Repository</DialogTitle>
            <DialogDescription>
              This will remove the repository connection from this workspace. Agents will lose
              codebase context. You can reconnect at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDisconnectOpen(false)}
              disabled={disconnectingRepo}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisconnectRepo}
              disabled={disconnectingRepo}
            >
              {disconnectingRepo ? (
                <>
                  <Loader2 size={14} className="mr-1.5 animate-spin" />
                  Disconnecting...
                </>
              ) : (
                'Disconnect'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Workspace</DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{activeWorkspace.name}</strong> and all
              associated data. Type the workspace name to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={activeWorkspace.name}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={!canDelete || deleting}>
              {deleting ? 'Deleting...' : 'Delete Forever'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
