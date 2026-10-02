'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Loader2,
  Github,
  Search,
  Lock,
  Globe,
  CheckCircle2,
  AlertCircle,
  LinkIcon,
} from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/tooltip';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';

interface GitHubRepo {
  id: number;
  full_name: string;
  html_url: string;
  private: boolean;
  default_branch: string;
  description: string | null;
}

interface GitHubRepoSelectorProps {
  /** Workspace to fetch repos for (must have github_installation_id) */
  workspaceId: string;
  /** Whether the workspace has a GitHub App installation */
  hasInstallation: boolean;
  /** Currently connected repo URL for THIS workspace (if any) */
  connectedRepoUrl?: string | null;
  /** Repo URLs already in use by OTHER workspaces — shown as disabled */
  usedRepoUrls?: string[];
  /** Called when user selects a repo */
  onSelect: (repo: GitHubRepo) => void;
  /** Called when user wants to install the GitHub App */
  onInstall: () => void;
  /** When true, renders without its own outer border (for embedding inside a parent card) */
  inline?: boolean;
  /** External search value — when provided, hides the built-in search input */
  externalSearch?: string;
}

export function GitHubRepoSelector({
  workspaceId,
  hasInstallation,
  connectedRepoUrl,
  usedRepoUrls = [],
  onSelect,
  onInstall,
  inline = false,
  externalSearch,
}: GitHubRepoSelectorProps) {
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!hasInstallation) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchJson<{ repos: GitHubRepo[] }>(apiUrl(`/api/github/repos?workspace_id=${workspaceId}`))
      .then((data) => {
        if (!cancelled) setRepos(data.repos ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          let msg = 'Failed to load repositories';
          if (err instanceof Error) {
            // fetchJson errors include raw JSON — extract a clean message
            const match = err.message.match(/"error"\s*:\s*"([^"]+)"/);
            msg = match ? match[1] : err.message;
          }
          setError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId, hasInstallation]);

  const activeSearch = externalSearch ?? search;

  const filtered = useMemo(() => {
    if (!activeSearch.trim()) return repos;
    const q = activeSearch.toLowerCase();
    return repos.filter(
      (r) => r.full_name.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q),
    );
  }, [repos, activeSearch]);

  // Normalize URLs for comparison
  const connectedFullName = connectedRepoUrl
    ? connectedRepoUrl.replace('https://github.com/', '').replace(/\/$/, '')
    : null;

  const usedFullNames = useMemo(
    () => new Set(usedRepoUrls.map((u) => u.replace('https://github.com/', '').replace(/\/$/, ''))),
    [usedRepoUrls],
  );

  // --- No installation: show connect button ---
  if (!hasInstallation) {
    return (
      <div className="border-border flex items-center justify-between rounded-lg border border-dashed px-4 py-6">
        <div>
          <p className="text-foreground text-sm font-medium">GitHub not connected</p>
          <p className="text-foreground-muted mt-0.5 text-sm">
            Install the GitHub App to access your repositories.
          </p>
        </div>
        <Button variant="outline" onClick={onInstall}>
          <Github size={15} className="mr-2" />
          Connect to GitHub
        </Button>
      </div>
    );
  }

  // --- Loading ---
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="text-foreground-muted animate-spin" />
        <span className="text-foreground-muted ml-2 text-sm">Loading repositories...</span>
      </div>
    );
  }

  // --- Error ---
  if (error) {
    return (
      <div className="border-border rounded-lg border px-4 py-4">
        <div className="flex items-start gap-2">
          <AlertCircle size={16} className="text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-foreground text-sm font-medium">Failed to load repositories</p>
            <p className="text-foreground-muted mt-0.5 text-sm">{error}</p>
            <p className="text-foreground-muted mt-1 text-xs">
              Make sure the GitHub App has access to at least one repository in your GitHub
              settings.
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" onClick={onInstall}>
            Reconnect GitHub
          </Button>
        </div>
      </div>
    );
  }

  // --- No repos found ---
  if (repos.length === 0) {
    return (
      <div className="border-border rounded-lg border border-dashed px-4 py-6 text-center">
        <p className="text-foreground text-sm font-medium">No repositories found</p>
        <p className="text-foreground-muted mt-1 text-sm">
          The GitHub App installation doesn&apos;t have access to any repositories. Check your
          GitHub App permissions.
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={onInstall}>
          Manage GitHub App
        </Button>
      </div>
    );
  }

  // --- Repo list ---
  return (
    <div>
      {/* Search — hidden when parent controls search externally */}
      {externalSearch === undefined && repos.length > 5 && (
        <div className="px-4 pt-3 pb-2">
          <div className="relative">
            <Search
              size={14}
              className="text-foreground-muted absolute top-1/2 left-3 -translate-y-1/2"
            />
            <Input
              placeholder="Search repositories..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      )}

      {/* Repo list */}
      <div
        className={`max-h-[280px] overflow-x-hidden overflow-y-auto ${inline ? '' : 'border-border rounded-lg border'}`}
      >
        {filtered.map((repo) => {
          const isConnected = connectedFullName === repo.full_name;
          const isUsedByOther = !isConnected && usedFullNames.has(repo.full_name);
          return (
            <div
              key={repo.id}
              className={`border-border flex w-full items-center justify-between border-b px-4 py-3 last:border-b-0 ${
                isConnected ? 'bg-brand/5' : isUsedByOther ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10">
                  <Github size={16} className="text-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-foreground truncate text-sm font-medium">
                      {repo.full_name}
                    </span>
                    {repo.private ? (
                      <Lock size={11} className="text-foreground-muted shrink-0" />
                    ) : (
                      <Globe size={11} className="text-foreground-muted shrink-0" />
                    )}
                  </div>
                  {repo.description && (
                    <p className="text-foreground-muted truncate text-xs">{repo.description}</p>
                  )}
                </div>
              </div>
              <div className="ml-3 shrink-0">
                {isConnected ? (
                  <span className="text-brand flex items-center gap-1 text-xs font-medium">
                    <CheckCircle2 size={14} />
                    Connected
                  </span>
                ) : isUsedByOther ? (
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-foreground-muted flex items-center gap-1 text-xs">
                          <LinkIcon size={12} />
                          In use
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-xs text-xs">
                        This repository is already connected to another workspace.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="sm" onClick={() => onSelect(repo)}>
                          Connect
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-xs text-xs">
                        Connect this repository to enable agent access.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && search.trim() && (
          <div className="px-4 py-6 text-center">
            <p className="text-foreground-muted text-sm">
              No repositories match &ldquo;{search}&rdquo;
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
