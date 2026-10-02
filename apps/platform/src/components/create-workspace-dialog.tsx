'use client';

import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Github, Loader2, Search, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@repo/ui/components/dialog';
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { Label } from '@repo/ui/components/label';
import { toast } from 'sonner';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import { useCanCreateWorkspace } from '@/hooks/use-can-create-workspace';
import { GitHubRepoSelector } from '@/components/settings/github-repo-selector';
import type { Workspace } from '@repo/types';

interface GitHubRepo {
  id: number;
  full_name: string;
  html_url: string;
  private: boolean;
  default_branch: string;
  description: string | null;
}

interface CreateWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateWorkspaceDialog({ open, onOpenChange }: CreateWorkspaceDialogProps) {
  const { workspaces, refreshWorkspaces, switchToWorkspaceBySlug } = useWorkspace();
  const { canCreate, currentCount, limit } = useCanCreateWorkspace();

  // Find main workspace for installation ID
  const mainWorkspace = workspaces.find((w: Workspace) => w.is_default);
  const hasInstallation = !!mainWorkspace?.github_installation_id;

  // Repo URLs already in use by other workspaces
  const usedRepoUrls = workspaces
    .filter((w: Workspace) => w.repo_url)
    .map((w: Workspace) => w.repo_url!);

  // Step 1: workspace name, Step 2: repo selection
  const [name, setName] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoRefreshKey, setRepoRefreshKey] = useState(0);
  const [addedNewRepo, setAddedNewRepo] = useState(false);
  const [repoSearch, setRepoSearch] = useState('');

  // Re-fetch workspaces when user returns from GitHub auth tab
  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState === 'visible' && open && step === 2) {
      refreshWorkspaces();
      setRepoRefreshKey((k) => k + 1);
      setAddedNewRepo(true);
    }
  }, [open, step, refreshWorkspaces]);

  useEffect(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [handleVisibilityChange]);

  const trimmedName = name.trim();
  const isNameValid = trimmedName.length >= 2 && trimmedName.length <= 100;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (step === 1) {
      if (!isNameValid) return;
      setError(null);
      setStep(2);
      return;
    }
  }

  async function handleCreateWithRepo(repo: GitHubRepo) {
    if (submitting) return;
    setSelectedRepo(repo);
    setSubmitting(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        name: trimmedName,
        repo_url: repo.html_url,
        repo_provider: 'github',
        repo_path: '/',
        github_default_branch: repo.default_branch,
      };

      const result = await fetchJson<{ id: string; slug: string }>(apiUrl('/api/workspaces'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (result?.slug) {
        await refreshWorkspaces();
        switchToWorkspaceBySlug(result.slug);
        onOpenChange(false);
        resetState();
        toast.success(`${trimmedName} created`);
      }
    } catch (err) {
      let message = 'Failed to create workspace';
      if (err instanceof Error) {
        // fetchJson errors include raw JSON — extract a clean message
        const match = err.message.match(/"error"\s*:\s*"([^"]+)"/);
        message = match ? match[1] : err.message;
      }
      setError(message);
    } finally {
      setSubmitting(false);
      setSelectedRepo(null);
    }
  }

  function handleGitHubInstall() {
    if (!mainWorkspace) return;
    window.open(apiUrl(`/api/github/install?workspace_id=${mainWorkspace.id}`), '_blank');
  }

  function handleResetNewRepo() {
    setAddedNewRepo(false);
    setRepoRefreshKey((k) => k + 1);
  }

  function resetState() {
    setName('');
    setStep(1);
    setSelectedRepo(null);
    setError(null);
    setAddedNewRepo(false);
    setRepoSearch('');
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetState();
    onOpenChange(next);
  }

  function handleBack() {
    setError(null);
    setStep(1);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-[#141414] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Workspace</DialogTitle>
          <DialogDescription>
            {step === 1
              ? 'Workspaces organize your agents, tasks, and settings.'
              : `Select a repository for "${trimmedName}".`}
          </DialogDescription>
        </DialogHeader>

        {!canCreate ? (
          <div className="py-4">
            <p className="text-foreground-lighter text-sm">
              You&apos;ve reached your plan limit of {limit} workspace{limit !== 1 ? 's' : ''}.{' '}
              <a href="/settings?tab=billing" className="text-brand hover:underline">
                Upgrade your plan
              </a>{' '}
              to create more.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {step === 1 && (
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="workspace-name">Name</Label>
                  <Input
                    id="workspace-name"
                    placeholder="My Project"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    minLength={2}
                    maxLength={100}
                    autoFocus
                  />
                  <p className="text-foreground-muted text-xs">
                    {limit !== null
                      ? `${currentCount} of ${limit} workspaces used`
                      : `${currentCount} workspace${currentCount !== 1 ? 's' : ''}`}
                  </p>
                </div>
                {error && <p className="text-destructive text-sm">{error}</p>}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4 py-4">
                {submitting && (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 size={20} className="text-foreground-muted animate-spin" />
                    <span className="text-foreground-muted ml-2 text-sm">
                      Creating workspace...
                    </span>
                  </div>
                )}

                {!submitting && (
                  <>
                    {/* Search above the repo list */}
                    {hasInstallation && (
                      <div className="relative">
                        <Search
                          size={14}
                          className="text-foreground-muted absolute top-1/2 left-3 -translate-y-1/2"
                        />
                        <input
                          type="text"
                          placeholder="Search repositories..."
                          value={repoSearch}
                          onChange={(e) => setRepoSearch(e.target.value)}
                          className="border-border bg-surface-75 text-foreground placeholder:text-foreground-muted block w-full rounded-md border py-2 pr-3 pl-9 text-sm focus:border-white/20 focus:outline-none"
                        />
                      </div>
                    )}

                    {/* Repo list */}
                    <div className="border-border overflow-hidden rounded-lg border">
                      <div className="p-0">
                        <GitHubRepoSelector
                          key={repoRefreshKey}
                          workspaceId={mainWorkspace?.id ?? ''}
                          hasInstallation={hasInstallation}
                          usedRepoUrls={usedRepoUrls}
                          onSelect={handleCreateWithRepo}
                          onInstall={handleGitHubInstall}
                          externalSearch={repoSearch}
                          inline
                        />
                      </div>
                    </div>

                    {/* Add another repo option */}
                    {hasInstallation && (
                      <>
                        <div className="flex items-center gap-3">
                          <div className="border-border flex-1 border-t" />
                          <span className="text-foreground-muted text-xs">or</span>
                          <div className="border-border flex-1 border-t" />
                        </div>

                        <div className="border-border flex items-center justify-between rounded-lg border px-4 py-3">
                          <div>
                            <p className="text-foreground text-sm font-medium">
                              Use another repository
                            </p>
                            <p className="text-foreground-muted mt-0.5 text-xs">
                              Grant access to additional repos
                            </p>
                          </div>
                          {addedNewRepo ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleResetNewRepo}
                            >
                              <X size={14} className="mr-1.5" />
                              Disconnect
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleGitHubInstall}
                            >
                              <Github size={14} className="mr-1.5" />
                              Add on GitHub
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}

                {error && <p className="text-destructive text-sm">{error}</p>}
              </div>
            )}

            <DialogFooter>
              {step === 2 ? (
                <div className="flex w-full items-center justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleBack}
                    disabled={submitting}
                  >
                    <ArrowLeft size={14} className="mr-1" />
                    Back
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenChange(false)}
                    disabled={submitting}
                    className="text-foreground-muted"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex w-full items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenChange(false)}
                    className="text-foreground-muted"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={!isNameValid}>
                    Next
                  </Button>
                </div>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
