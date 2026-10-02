'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  Trash2,
  Github,
  ExternalLink,
  FolderOpen,
  CircleHelp,
  AlertTriangle,
  X,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { Label } from '@repo/ui/components/label';
import { Textarea } from '@repo/ui/components/textarea';
import { Badge } from '@repo/ui/components/badge';
import { Switch } from '@repo/ui/components/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@repo/ui/components/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/tooltip';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import type { Workspace, Plan, GitHubSettings } from '@repo/types';
import { PLAN_LABELS } from '@repo/types';
import { parseGitHubUrl } from '@/lib/github-utils';
import { GitHubRepoSelector } from './github-repo-selector';
import { SettingsInvitationsSection } from './settings-invitations-section';

function formatRepoUrl(url: string): string {
  const parsed = parseGitHubUrl(url);
  if (parsed) return parsed.fullName;
  // Fallback for non-GitHub URLs
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return url;
  }
}

function formatConnectedDate(iso: string): string {
  try {
    const now = new Date();
    const date = new Date(iso);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Connected just now';
    if (diffMins < 60) return `Connected ${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `Connected ${diffHours}h ago`;
    return `Connected ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  } catch {
    return `Connected ${iso}`;
  }
}

/** Vercel-style settings card wrapper */
function SettingsCard({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <div className="p-6">{children}</div>
      {footer && (
        <div className="border-border bg-surface-75 flex items-center justify-between border-t px-6 py-3">
          {footer}
        </div>
      )}
    </div>
  );
}

/** Toggle row for settings, matching Vercel's label + switch pattern */
function SettingsToggle({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="border-border flex items-center justify-between border-b py-3 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="text-sm">{label}</span>
        {description && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <CircleHelp size={14} className="text-foreground-muted" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs text-xs">
                {description}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-foreground-muted text-sm">{checked ? 'Enabled' : 'Disabled'}</span>
        <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      </div>
    </div>
  );
}

export function SettingsWorkspaceTab() {
  const { activeWorkspace, workspaces, refreshWorkspaces } = useWorkspace();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Repo connection
  const [connectingRepo, setConnectingRepo] = useState(false);

  // Disconnect confirmation
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Workspace delete state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  // GitHub settings (persisted to workspace.github_settings)
  const defaultSettings: GitHubSettings = {
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
  const [ghSettings, setGhSettings] = useState<GitHubSettings>(defaultSettings);
  const [savingGh, setSavingGh] = useState(false);

  // Load github_settings from workspace on mount
  useEffect(() => {
    if (!activeWorkspace) return;
    const ws = activeWorkspace as Workspace & { github_settings?: GitHubSettings | null };
    if (ws.github_settings) {
      setGhSettings({ ...defaultSettings, ...ws.github_settings });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      toast.success('GitHub settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSavingGh(false);
    }
  }

  // Heartbeat configuration (stored in workspace metadata.heartbeat_config)
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(true);
  const [heartbeatInterval, setHeartbeatInterval] = useState(30);
  const [staleMultiplier, setStaleMultiplier] = useState(3);

  useEffect(() => {
    if (!activeWorkspace) return;
    const meta = (activeWorkspace as Workspace & { metadata?: Record<string, unknown> | null })
      .metadata;
    const hbConfig = (meta as Record<string, unknown>)?.heartbeat_config as
      Record<string, unknown> | undefined;
    if (hbConfig) {
      if (typeof hbConfig.enabled === 'boolean') setHeartbeatEnabled(hbConfig.enabled);
      if (typeof hbConfig.ping_interval_seconds === 'number')
        setHeartbeatInterval(hbConfig.ping_interval_seconds);
      if (typeof hbConfig.stale_threshold_multiplier === 'number')
        setStaleMultiplier(hbConfig.stale_threshold_multiplier);
    }
  }, [activeWorkspace]);

  async function saveHeartbeatConfig(updates: Record<string, unknown>) {
    if (!activeWorkspace) return;
    try {
      const existingMeta =
        (activeWorkspace as Workspace & { metadata?: Record<string, unknown> | null }).metadata ??
        {};
      const existingHb =
        ((existingMeta as Record<string, unknown>).heartbeat_config as Record<string, unknown>) ??
        {};
      await fetchJson(apiUrl(`/api/workspaces/${activeWorkspace.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadata: {
            ...(existingMeta as Record<string, unknown>),
            heartbeat_config: { ...existingHb, ...updates },
          },
        }),
      });
      toast.success('Heartbeat settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save heartbeat settings');
    }
  }

  // Agent behavior settings (stored in workspace metadata)
  const [autoOpenUrls, setAutoOpenUrls] = useState(true);

  useEffect(() => {
    if (!activeWorkspace) return;
    const meta = (activeWorkspace as Workspace & { metadata?: Record<string, unknown> | null })
      .metadata;
    if (meta && typeof meta === 'object' && 'auto_open_urls' in meta) {
      setAutoOpenUrls(meta.auto_open_urls !== false);
    }
  }, [activeWorkspace]);

  async function handleToggleAutoOpen(checked: boolean) {
    if (!activeWorkspace) return;
    setAutoOpenUrls(checked);
    try {
      const existingMeta =
        (activeWorkspace as Workspace & { metadata?: Record<string, unknown> | null }).metadata ??
        {};
      await fetchJson(apiUrl(`/api/workspaces/${activeWorkspace.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: { ...existingMeta, auto_open_urls: checked } }),
      });
      toast.success(checked ? 'Auto-open URLs enabled' : 'Auto-open URLs disabled');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save setting');
      setAutoOpenUrls(!checked);
    }
  }

  // Plan info for invitation gating
  const [currentPlan, setCurrentPlan] = useState<Plan>('cloud');
  useEffect(() => {
    if (!activeWorkspace) return;
    fetchJson<{ plan: Plan }>(apiUrl(`/api/workspaces/plan?workspace_id=${activeWorkspace.id}`))
      .then((data) => setCurrentPlan(data.plan))
      .catch(() => setCurrentPlan('cloud'));
  }, [activeWorkspace]);

  // GitHub connection health
  const githubHealthy = !!activeWorkspace?.github_installation_id && !!activeWorkspace?.repo_url;

  useEffect(() => {
    if (!activeWorkspace) return;
    setName(activeWorkspace.name ?? '');
    setDescription(activeWorkspace.description ?? '');
  }, [activeWorkspace]);

  // Try to sync org-level GitHub installation to this workspace.
  // Fires on mount (handles in-app navigation from Integrations tab)
  // and on visibility change (handles returning from GitHub auth tab).
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

  // On mount: sync if workspace is missing installation
  useEffect(() => {
    trySyncInstallation();
  }, [trySyncInstallation]);

  // On visibility change: re-fetch + sync (handles returning from GitHub auth tab)
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return;
      await trySyncInstallation();
      await refreshWorkspaces();
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
  const hasInstallation = !!activeWorkspace.github_installation_id;

  // Collect repo URLs used by OTHER workspaces (to disable them in the selector)
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
    setDisconnecting(true);
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
      setDisconnecting(false);
    }
  }

  async function handleDisconnectInstallation() {
    if (!activeWorkspace) return;
    setDisconnecting(true);
    try {
      await fetchJson(apiUrl(`/api/workspaces/${activeWorkspace.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ github_installation_id: null }),
      });
      await refreshWorkspaces();
      toast.success('GitHub connection removed from this workspace');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
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
    <div className="max-w-2xl space-y-8">
      {/* Workspace Details Card */}
      <SettingsCard
        footer={
          <div className="flex w-full items-center justify-between">
            <p className="text-foreground-muted text-sm">
              Used to identify your workspace across the platform.
            </p>
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
      <SettingsCard
        footer={
          repoUrl ? (
            <div className="flex w-full items-center justify-between">
              <p className="text-foreground-muted text-sm">
                Agents use this connection for codebase context.
              </p>
              <Button variant="outline" size="sm" onClick={() => setDisconnectOpen(true)}>
                Change Repository
              </Button>
            </div>
          ) : undefined
        }
      >
        {repoUrl ? (
          <>
            <h3 className="mb-1 text-base font-semibold">Connected Git Repository</h3>
            <p className="text-foreground-muted mb-5 text-sm">
              This workspace is linked to a codebase for agent context and GitHub sync.
            </p>

            {/* Connected repo row — Vercel style */}
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
                  {/* Status dot overlay on icon */}
                  <span
                    className={`absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-[var(--surface-75)] ${
                      githubHealthy ? 'bg-emerald-500' : 'bg-zinc-500'
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
                    {githubHealthy ? (
                      <Badge variant="emerald" className="text-xs">
                        <CheckCircle2 size={10} className="mr-0.5" />
                        Connected
                      </Badge>
                    ) : (
                      <Badge variant="coral" className="text-xs">
                        <XCircle size={10} className="mr-0.5" />
                        Disconnected
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

            {/* Installation missing warning */}
            {!hasInstallation && (
              <div className="bg-destructive/5 border-destructive/20 mb-5 flex items-start gap-2.5 rounded-lg border px-4 py-3">
                <AlertTriangle size={15} className="text-destructive mt-0.5 shrink-0" />
                <div>
                  <p className="text-foreground text-sm font-medium">GitHub connection lost</p>
                  <p className="text-foreground-muted mt-0.5 text-xs">
                    The organization&apos;s GitHub App has been disconnected. Agent codebase
                    features, branch management, and PR workflows won&apos;t work until the
                    connection is restored.
                  </p>
                </div>
              </div>
            )}

            {/* Feature toggles — persisted to github_settings */}
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

            {/* PR & Branch Strategy — Vercel style */}
            <div className="mt-6">
              <h4 className="mb-1 text-sm font-semibold">Pull Request Strategy</h4>
              <p className="text-foreground-muted mb-3 text-xs">
                Controls how PRs are created when agents push code.
              </p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pr-strategy" className="text-xs">
                    PR Grouping
                  </Label>
                  <select
                    id="pr-strategy"
                    value={ghSettings.pr_strategy}
                    onChange={(e) =>
                      handleSaveGhSettings({
                        pr_strategy: e.target.value as GitHubSettings['pr_strategy'],
                      })
                    }
                    className="border-border bg-surface text-foreground w-full rounded-md border px-3 py-1.5 text-sm"
                  >
                    <option value="per_project">One PR per project (recommended)</option>
                    <option value="per_task">One PR per task</option>
                    <option value="manual">Manual — agents don&apos;t auto-create PRs</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="auto-pr" className="text-xs">
                    Auto-Create PRs
                  </Label>
                  <select
                    id="auto-pr"
                    value={ghSettings.auto_pr}
                    onChange={(e) =>
                      handleSaveGhSettings({
                        auto_pr: e.target.value as GitHubSettings['auto_pr'],
                      })
                    }
                    className="border-border bg-surface text-foreground w-full rounded-md border px-3 py-1.5 text-sm"
                  >
                    <option value="draft_on_push">Create draft PR on first push</option>
                    <option value="ready_on_push">Create ready PR on first push</option>
                    <option value="off">Off — create PRs manually</option>
                  </select>
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
                      handleSaveGhSettings({ default_reviewers: ghSettings.default_reviewers })
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
            <div className="mt-6">
              <h4 className="mb-1 text-sm font-semibold">Branch Naming</h4>
              <p className="text-foreground-muted mb-3 text-xs">
                Convention used when agents create branches. Preview:{' '}
                <code className="bg-surface-200 rounded px-1 py-0.5 text-xs">
                  {ghSettings.branch_naming.prefix}
                  {ghSettings.branch_naming.separator}
                  {ghSettings.branch_naming.include_assignee
                    ? 'rick' + ghSettings.branch_naming.separator
                    : ''}
                  project-name
                </code>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="branch-prefix" className="text-xs">
                    Prefix
                  </Label>
                  <Input
                    id="branch-prefix"
                    value={ghSettings.branch_naming.prefix}
                    onChange={(e) =>
                      setGhSettings((s) => ({
                        ...s,
                        branch_naming: { ...s.branch_naming, prefix: e.target.value },
                      }))
                    }
                    onBlur={() => handleSaveGhSettings({ branch_naming: ghSettings.branch_naming })}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="branch-sep" className="text-xs">
                    Separator
                  </Label>
                  <select
                    id="branch-sep"
                    value={ghSettings.branch_naming.separator}
                    onChange={(e) =>
                      handleSaveGhSettings({
                        branch_naming: { ...ghSettings.branch_naming, separator: e.target.value },
                      })
                    }
                    className="border-border bg-surface text-foreground w-full rounded-md border px-3 py-1.5 text-sm"
                  >
                    <option value="/">/</option>
                    <option value="-">-</option>
                    <option value="_">_</option>
                  </select>
                </div>
              </div>
              <div className="mt-3">
                <SettingsToggle
                  label="Include assignee in branch name"
                  description="Adds the agent or user name between the prefix and project slug."
                  checked={ghSettings.branch_naming.include_assignee}
                  onCheckedChange={(v) =>
                    handleSaveGhSettings({
                      branch_naming: { ...ghSettings.branch_naming, include_assignee: v },
                    })
                  }
                  disabled={savingGh}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-base font-semibold">Connect a Git Repository</h3>
              {hasInstallation && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-foreground-muted hover:text-destructive -mr-2"
                  onClick={handleDisconnectInstallation}
                  disabled={disconnecting}
                >
                  {disconnecting ? (
                    <Loader2 size={14} className="mr-1.5 animate-spin" />
                  ) : (
                    <X size={14} className="mr-1.5" />
                  )}
                  Disconnect
                </Button>
              )}
            </div>
            <p className="text-foreground-muted mb-5 text-sm">
              Link a repository to give agents codebase context for this workspace.
            </p>

            {hasInstallation ? (
              <GitHubRepoSelector
                key={`repos-${activeWorkspace.github_installation_id}`}
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

      {/* Team Invitations Card */}
      <SettingsInvitationsSection
        planAllowsInvites={currentPlan !== 'unpaid'}
        planLabel={PLAN_LABELS[currentPlan]}
      />

      {/* Agent Behavior Card */}
      <SettingsCard>
        <h3 className="mb-1 text-base font-semibold">Agent Behavior</h3>
        <p className="text-foreground-muted mb-5 text-sm">
          Control how agents interact with your browser and workspace.
        </p>
        <SettingsToggle
          label="Auto-open URLs"
          description="Allow agents to navigate you to pages in the app during chat conversations."
          checked={autoOpenUrls}
          onCheckedChange={handleToggleAutoOpen}
        />
      </SettingsCard>

      {/* Heartbeat Configuration Card */}
      <SettingsCard
        footer={
          <div className="flex w-full items-center justify-between">
            <p className="text-foreground-muted text-sm">
              Controls how frequently agents report their status.
            </p>
            <Button
              size="sm"
              onClick={() =>
                saveHeartbeatConfig({
                  enabled: heartbeatEnabled,
                  ping_interval_seconds: heartbeatInterval,
                  stale_threshold_multiplier: staleMultiplier,
                })
              }
            >
              Save
            </Button>
          </div>
        }
      >
        <h3 className="mb-1 text-base font-semibold">Heartbeat</h3>
        <p className="text-foreground-muted mb-5 text-sm">
          Configure agent health monitoring and stale detection.
        </p>

        <div className="space-y-4">
          <SettingsToggle
            label="Enable heartbeat monitoring"
            description="Track agent activity and detect stale sessions automatically."
            checked={heartbeatEnabled}
            onCheckedChange={(v) => setHeartbeatEnabled(v)}
          />

          <div className="space-y-2">
            <Label htmlFor="hb-interval">Ping interval</Label>
            <select
              id="hb-interval"
              value={heartbeatInterval}
              onChange={(e) => setHeartbeatInterval(Number(e.target.value))}
              className="border-border bg-surface-200 text-foreground w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value={10}>Every 10 seconds</option>
              <option value={30}>Every 30 seconds</option>
              <option value={60}>Every 60 seconds</option>
              <option value={120}>Every 2 minutes</option>
              <option value={300}>Every 5 minutes</option>
            </select>
            <p className="text-foreground-muted text-xs">How often agents report their status.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="hb-stale">Stale threshold</Label>
            <select
              id="hb-stale"
              value={staleMultiplier}
              onChange={(e) => setStaleMultiplier(Number(e.target.value))}
              className="border-border bg-surface-200 text-foreground w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value={2}>2x interval ({heartbeatInterval * 2}s)</option>
              <option value={3}>3x interval ({heartbeatInterval * 3}s)</option>
              <option value={5}>5x interval ({heartbeatInterval * 5}s)</option>
              <option value={10}>10x interval ({heartbeatInterval * 10}s)</option>
            </select>
            <p className="text-foreground-muted text-xs">
              Agent is marked stale after missing this many consecutive heartbeats.
            </p>
          </div>
        </div>
      </SettingsCard>

      {/* Danger Zone Card */}
      {!isDefault && (
        <SettingsCard
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
            Permanently delete <strong>{activeWorkspace.name}</strong> and all associated agents,
            tasks, API keys, and webhooks. This cannot be undone.
          </p>
        </SettingsCard>
      )}

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
              disabled={disconnecting}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDisconnectRepo} disabled={disconnecting}>
              {disconnecting ? (
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
