'use client';

import { useEffect } from 'react';
import { Card, CardContent } from '@repo/ui/components/card';
import { Check, Loader2 } from 'lucide-react';
import type { Task } from '@repo/types';

export type SkeletonPhase = 'generating' | 'success' | 'reveal';

interface TaskCardSkeletonProps {
  phase: SkeletonPhase;
  task?: Task | null;
  projectName?: string;
  onTransitionEnd?: () => void;
}

export function TaskCardSkeleton({
  phase,
  task,
  projectName,
  onTransitionEnd,
}: TaskCardSkeletonProps) {
  // Fire onTransitionEnd after the reveal phase completes
  useEffect(() => {
    if (phase !== 'reveal') return;
    const timer = setTimeout(() => onTransitionEnd?.(), 600);
    return () => clearTimeout(timer);
  }, [phase, onTransitionEnd]);

  return (
    <Card
      className="relative rounded border-(--celune-border) select-none"
      style={{ backgroundColor: 'var(--celune-surface)' }}
    >
      <CardContent className="space-y-2 p-5">
        {/* Title area */}
        <div className="flex items-center gap-2 py-1" style={{ minHeight: '20px' }}>
          {phase === 'generating' && (
            <Loader2 className="h-4 w-4 animate-spin text-(--celune-primary)" />
          )}
          {phase === 'success' && (
            <Check className="animate-task-generate-check h-5 w-5 text-(--celune-status-done)" />
          )}
          {phase === 'reveal' && task && (
            <span
              className="text-sm transition-opacity duration-300"
              style={{
                fontWeight: 'var(--celune-font-weight-regular)',
                lineHeight: '140%',
                opacity: 1,
              }}
            >
              {task.title}
            </span>
          )}
          {phase === 'generating' && (
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-(--celune-surface-hover) motion-reduce:animate-none" />
          )}
        </div>

        {/* Badges / project area */}
        <div className="mt-1 flex items-center gap-1.5">
          {phase === 'generating' && (
            <>
              <div className="h-5 w-16 animate-pulse rounded bg-(--celune-surface-hover) motion-reduce:animate-none" />
              <div className="h-5 w-12 animate-pulse rounded bg-(--celune-surface-hover) motion-reduce:animate-none" />
            </>
          )}
          {phase === 'success' && <div className="h-5 w-16 rounded bg-(--celune-status-done)/10" />}
          {phase === 'reveal' && projectName && (
            <span className="truncate text-xs font-(weight:--celune-font-weight-strong) text-(--celune-fg-muted) opacity-100 transition-opacity duration-300">
              {projectName}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
