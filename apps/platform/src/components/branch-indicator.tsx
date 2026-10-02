'use client';

import { useState, useEffect } from 'react';
import { GitBranch } from 'lucide-react';
import { useWorkspace } from '@/providers/workspace-provider';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';

interface BranchData {
  default_branch: string;
  repo: string;
  branches: Array<{
    name: string;
    is_default: boolean;
    is_celune: boolean;
    ahead: number;
    behind: number;
  }>;
}

export function BranchIndicator() {
  const { activeWorkspace } = useWorkspace();
  const [data, setData] = useState<BranchData | null>(null);

  const hasGithub = activeWorkspace?.github_installation_id && activeWorkspace?.repo_url;

  useEffect(() => {
    if (!hasGithub || !activeWorkspace?.id) return;

    fetchJson<BranchData>(apiUrl(`/api/github/branches?workspace_id=${activeWorkspace.id}`))
      .then(setData)
      .catch((err) => {
        console.warn('[BranchIndicator] Failed to fetch branches:', err);
        setData(null);
      });
  }, [hasGithub, activeWorkspace?.id]);

  if (!hasGithub || !data) return null;

  const activeBranches = data.branches.filter((b) => b.is_celune && !b.is_default);
  const defaultBranch = data.default_branch;

  return (
    <div className="flex flex-col gap-1 px-1">
      <div className="text-muted-foreground flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wider uppercase">
        <GitBranch className="h-3 w-3" />
        <span>{data.repo}</span>
      </div>
      {activeBranches.length > 0 ? (
        activeBranches.slice(0, 3).map((branch) => (
          <Tooltip key={branch.name}>
            <TooltipTrigger asChild>
              <div className="text-foreground-lighter hover:text-foreground flex items-center gap-2 rounded px-2 py-0.5 text-[11px] transition-colors">
                <code className="truncate">{branch.name}</code>
                {branch.ahead > 0 && (
                  <span className="text-brand shrink-0 text-[9px] font-medium">
                    +{branch.ahead}
                  </span>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              {branch.ahead > 0 && `${branch.ahead} ahead`}
              {branch.ahead > 0 && branch.behind > 0 && ', '}
              {branch.behind > 0 && `${branch.behind} behind`}
              {branch.ahead === 0 && branch.behind === 0 && 'Up to date'}
              {' of '}
              {defaultBranch}
            </TooltipContent>
          </Tooltip>
        ))
      ) : (
        <div className="text-muted-foreground px-2 text-[11px]">
          <code>{defaultBranch}</code>
        </div>
      )}
      {activeBranches.length > 3 && (
        <div className="text-muted-foreground px-2 text-[10px]">
          +{activeBranches.length - 3} more
        </div>
      )}
    </div>
  );
}
