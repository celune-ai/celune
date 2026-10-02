'use client';

import { GitBranch, GitMerge, GitPullRequest } from 'lucide-react';
import { Badge } from '@repo/ui/components/badge';
import type { ProjectGroup } from '@repo/types';

interface GroupBranchInfoProps {
  group: ProjectGroup;
  projectCount: number;
  mergedCount: number;
}

export function GroupBranchInfo({ group, projectCount, mergedCount }: GroupBranchInfoProps) {
  const meta = (group.metadata as Record<string, unknown>) ?? {};
  const branch = meta.branch as string | undefined;
  const groupPrNumber = meta.group_pr_number as number | undefined;
  const groupPrStatus = meta.group_pr_status as string | undefined;

  if (!branch) return null;

  const allMerged = mergedCount === projectCount && projectCount > 0;
  const progress = projectCount > 0 ? Math.round((mergedCount / projectCount) * 100) : 0;

  return (
    <div className="bg-surface-75 border-border mx-6 mt-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-surface-100 flex h-8 w-8 items-center justify-center rounded-full">
            <GitBranch className="text-muted-foreground h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <code className="text-foreground text-xs font-medium">{branch}</code>
              {groupPrStatus === 'merged' ? (
                <Badge
                  variant="default"
                  className="text-[9px]"
                  style={{ backgroundColor: 'var(--success-default)', color: 'var(--surface-75)' }}
                >
                  Merged to main
                </Badge>
              ) : allMerged ? (
                <Badge
                  variant="default"
                  className="text-[9px]"
                  style={{ backgroundColor: 'var(--brand-default)', color: 'var(--surface-75)' }}
                >
                  Ready for group PR
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[9px]">
                  {mergedCount}/{projectCount} merged
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground mt-0.5 text-[11px]">
              Group branch — project PRs merge here before rolling up to main
            </p>
          </div>
        </div>

        {/* Progress bar */}
        {projectCount > 0 && (
          <div className="flex items-center gap-3">
            <div className="bg-surface-200 h-1.5 w-24 overflow-hidden rounded-full">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${progress}%`,
                  backgroundColor: allMerged ? 'var(--success-default)' : 'var(--brand-default)',
                }}
              />
            </div>
            <span className="text-muted-foreground text-[11px] tabular-nums">{progress}%</span>
          </div>
        )}
      </div>

      {/* Branch tree */}
      {projectCount > 0 && (
        <div className="border-border mt-3 border-t pt-3">
          <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
            {groupPrNumber ? (
              <>
                <GitPullRequest className="h-3 w-3" />
                <span>Group PR #{groupPrNumber}</span>
                {groupPrStatus === 'merged' ? (
                  <GitMerge className="ml-1 h-3 w-3" style={{ color: 'var(--success-default)' }} />
                ) : null}
              </>
            ) : allMerged ? (
              <>
                <GitPullRequest className="h-3 w-3" />
                <span>All project PRs merged — group PR can be created</span>
              </>
            ) : (
              <>
                <GitMerge className="h-3 w-3" />
                <span>
                  {mergedCount} of {projectCount} project PRs merged into group branch
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
