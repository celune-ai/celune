'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import {
  Github,
  Plus,
  Trash2,
  AlertTriangle,
  Building2,
  User,
  Copy,
  Check,
  Settings2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { Skeleton } from '@repo/ui/components/skeleton';
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
import type { OrgGitHubInstallation } from '@repo/types';

interface GitHubAccountsCardProps {
  isOwner: boolean;
}

interface DisconnectImpact {
  installation: OrgGitHubInstallation;
  impact: {
    workspaces: Array<{ id: string; name: string; repo_url: string | null }>;
    workspace_count: number;
    active_pr_count: number;
  };
}

function ConfirmInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(label);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-sm">
        Type the following to confirm: <strong className="text-foreground">{label}</strong>
        <button
          type="button"
          onClick={handleCopy}
          className="text-muted-foreground hover:text-foreground ml-1.5 inline-flex translate-y-[2px] transition-colors"
          aria-label="Copy to clipboard"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </p>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function GitHubAccountsCard({ isOwner }: GitHubAccountsCardProps) {
  const { activeWorkspace } = useWorkspace();
  const [installations, setInstallations] = useState<OrgGitHubInstallation[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<number | null>(null);
  const [impactData, setImpactData] = useState<DisconnectImpact | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const fetchInstallations = useCallback(async () => {
    try {
      const resp = await fetchJson<{ installations: OrgGitHubInstallation[] }>(
        apiUrl('/api/github/installations'),
      );
      setInstallations(resp.installations);
    } catch {
      // Silent — may not have any installations
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInstallations();
  }, [fetchInstallations]);

  // Re-fetch when user returns from GitHub auth tab
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') fetchInstallations();
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [fetchInstallations]);

  // Listen for postMessage from the GitHub auth popup (github-connected / github-recheck)
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'github-connected' || event.data?.type === 'github-recheck') {
        fetchInstallations();
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [fetchInstallations]);

  function handleAddAccount() {
    if (!activeWorkspace) return;
    window.open(apiUrl(`/api/github/install?workspace_id=${activeWorkspace.id}`), '_blank');
  }

  async function handleDisconnectClick(installationId: number) {
    try {
      const resp = await fetchJson<DisconnectImpact>(
        apiUrl(`/api/github/installations/${installationId}`),
      );
      setImpactData(resp);
      setDisconnecting(installationId);
      setConfirmText('');
    } catch {
      toast.error('Failed to check disconnect impact');
    }
  }

  async function handleConfirmDisconnect() {
    if (!disconnecting || !impactData) return;

    try {
      await fetchJson(apiUrl(`/api/github/installations/${disconnecting}`), {
        method: 'DELETE',
      });
      toast.success(
        `Disconnected ${impactData.installation.github_account_login} from organization`,
      );
      setDisconnecting(null);
      setImpactData(null);
      fetchInstallations();
    } catch {
      toast.error('Failed to disconnect GitHub account');
    }
  }

  if (loading) {
    return (
      <div className="border-border overflow-hidden rounded-lg border">
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-52" />
              <Skeleton className="h-4 w-80" />
            </div>
          </div>
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="border-border bg-surface-75 flex items-center gap-3 rounded-lg border px-4 py-3"
              >
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="border-border overflow-hidden rounded-lg border">
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-foreground text-base font-semibold">Connected GitHub Accounts</h3>
              <p className="text-muted-foreground mt-0.5 text-sm">
                GitHub organizations and accounts linked to this Celune organization.
              </p>
            </div>
            {isOwner && (
              <Button variant="outline" size="sm" onClick={handleAddAccount}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add Account
              </Button>
            )}
          </div>

          {installations.length === 0 ? (
            <div className="border-border rounded-lg border border-dashed p-8 text-center">
              <div className="bg-surface-100 mx-auto flex h-12 w-12 items-center justify-center rounded-full">
                <Github className="text-muted-foreground h-6 w-6" />
              </div>
              <p className="text-foreground mt-4 text-sm font-medium">
                No GitHub accounts connected
              </p>
              <p className="text-muted-foreground mx-auto mt-1.5 max-w-xs text-xs">
                Connect a GitHub organization or personal account to enable repository access across
                all workspaces.
              </p>
              {isOwner && (
                <Button variant="outline" size="sm" className="mt-5" onClick={handleAddAccount}>
                  <Github className="mr-1.5 h-3.5 w-3.5" />
                  Connect to GitHub
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {installations.map((inst) => (
                <div
                  key={inst.id}
                  className="border-border bg-surface-75 group flex items-center gap-3 rounded-lg border px-4 py-3"
                >
                  {inst.github_account_avatar_url ? (
                    <Image
                      src={inst.github_account_avatar_url}
                      alt={inst.github_account_login}
                      className="h-8 w-8 rounded-full"
                      width={32}
                      height={32}
                      unoptimized
                    />
                  ) : (
                    <div className="bg-surface-200 flex h-8 w-8 items-center justify-center rounded-full">
                      <Github className="text-muted-foreground h-4 w-4" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground text-sm font-medium">
                        {inst.github_account_login === 'unknown' ||
                        inst.github_account_login === 'pending-sync'
                          ? 'Syncing...'
                          : inst.github_account_login}
                      </span>
                      <span className="bg-surface-200 text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs">
                        {inst.github_account_type === 'Organization' ? (
                          <Building2 className="h-3 w-3" />
                        ) : (
                          <User className="h-3 w-3" />
                        )}
                        {inst.github_account_type === 'User'
                          ? 'Personal'
                          : inst.github_account_type}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      Connected {new Date(inst.connected_at).toLocaleDateString()}
                    </p>
                  </div>

                  <a
                    href={`https://github.com/settings/installations/${inst.installation_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground-muted hover:text-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded opacity-0 transition-all group-hover:opacity-100 hover:bg-white/10 focus-visible:opacity-100 max-sm:opacity-50"
                    aria-label={`Manage GitHub App for ${inst.github_account_login}`}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </a>
                  {isOwner && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8 p-0"
                      onClick={() => handleDisconnectClick(inst.installation_id)}
                      aria-label={`Disconnect ${inst.github_account_login}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Disconnect confirmation dialog */}
      <Dialog open={!!disconnecting} onOpenChange={() => setDisconnecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="text-destructive h-5 w-5" />
              Disconnect GitHub Account?
            </DialogTitle>
            <DialogDescription>
              This will disconnect{' '}
              <strong className="text-foreground">
                {impactData?.installation.github_account_login}
              </strong>{' '}
              from your organization and clear all repo connections using this account.
            </DialogDescription>
          </DialogHeader>

          {impactData && impactData.impact.workspace_count > 0 && (
            <div className="bg-destructive/10 border-destructive/20 rounded-lg border p-3">
              <p className="text-foreground text-sm font-medium">
                This will affect {impactData.impact.workspace_count} workspace
                {impactData.impact.workspace_count !== 1 ? 's' : ''}
                {impactData.impact.active_pr_count > 0 &&
                  ` and ${impactData.impact.active_pr_count} active PR${impactData.impact.active_pr_count !== 1 ? 's' : ''}`}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-white/70">
                {impactData.impact.workspaces.map((ws) => (
                  <li key={ws.id}>
                    <span className="font-semibold text-white">{ws.name}</span>
                    {ws.repo_url && (
                      <span className="text-white/50">
                        {' '}
                        — {ws.repo_url.replace('https://github.com/', '')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ConfirmInput
            label={impactData?.installation.github_account_login ?? ''}
            value={confirmText}
            onChange={setConfirmText}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnecting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmText !== impactData?.installation.github_account_login}
              onClick={handleConfirmDisconnect}
            >
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
