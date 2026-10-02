'use client';

import { ArrowRight, Play, Square, Copy, Check, Link2, UserPlus, UserMinus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@repo/ui/components/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/tooltip';
import type { Task, TaskMetadata } from './types';
import { cn } from '@repo/ui/utils';
import { useElementClass } from '../../provider/appearance';

interface TaskDrawerHeaderProps {
  task: Task | null;
  title: string;
  onTitleChange: (title: string) => void;
  onTitleSave: () => void;
  onClose: () => void;
  /** Omit to hide the initiate control. */
  onInitiate?: () => void;
  onCancelInitiate: () => void;
  /** Omit to hide the claim control. */
  onClaim?: () => void;
  onUnclaim: () => void;
  initiating: boolean;
  claiming: boolean;
  canEdit?: boolean;
}

export function TaskDrawerHeader({
  task,
  title,
  onTitleChange,
  onTitleSave,
  onClose,
  onInitiate,
  onCancelInitiate,
  onClaim,
  onUnclaim,
  initiating,
  claiming,
  canEdit = true,
}: TaskDrawerHeaderProps) {
  const partClass = useElementClass('drawerHeader');
  const [idCopied, setIdCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const meta = task ? ((task.metadata ?? {}) as TaskMetadata) : null;
  const isActive = !!(meta?.initiated || meta?.active_session);
  const canInitiate = task && task.status !== 'done' && !isActive;
  const isClaimed = task && task.assignee !== 'unassigned';

  const copyTaskId = () => {
    if (!task) return;
    navigator.clipboard.writeText(task.id);
    setIdCopied(true);
    setTimeout(() => setIdCopied(false), 1500);
  };

  const copyLink = () => {
    if (!task) return;
    const url = `${window.location.origin}/tasks?task=${task.id}`;
    navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 5000);
  };

  return (
    <div className={cn('flex flex-col gap-1 p-5', partClass)}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <input
            value={title}
            onChange={(e) => canEdit && onTitleChange(e.target.value)}
            onBlur={canEdit ? onTitleSave : undefined}
            onKeyDown={(e) => {
              if (!canEdit) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            readOnly={!canEdit}
            className="w-full bg-transparent text-xl font-(weight:--celune-font-weight-strong) text-(--celune-fg) outline-none placeholder:text-(--celune-fg-muted)"
            placeholder="Task title"
          />
          {task && (
            <TooltipProvider delayDuration={500}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={copyTaskId}
                    className="group/id flex w-fit items-center gap-1.5 font-mono text-(length:--celune-text-2xs) text-(--celune-fg-muted) transition-colors hover:text-(--celune-fg)"
                    aria-label="Copy task ID"
                  >
                    {task.id.slice(0, 8)}
                    {idCopied ? (
                      <Check className="h-3 w-3 text-(--celune-status-done)" />
                    ) : (
                      <Copy className="h-3 w-3 opacity-0 group-hover/id:opacity-100" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {idCopied ? 'Copied!' : 'Copy task ID'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <TooltipProvider delayDuration={500}>
          <div className="flex shrink-0 items-center gap-1">
            {/* Copy link */}
            {task && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={copyLink}
                    aria-label="Copy task link"
                    className="h-8 w-8 p-0"
                  >
                    {linkCopied ? (
                      <Check className="h-4 w-4 text-(--celune-status-done) transition-colors" />
                    ) : (
                      <Link2 className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {linkCopied ? 'Copied!' : 'Copy link'}
                </TooltipContent>
              </Tooltip>
            )}

            {/* Claim / Unclaim — hidden for viewers */}
            {canEdit && task && task.status !== 'done' && (isClaimed || onClaim) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  {isClaimed ? (
                    <Button
                      variant="ghost"
                      size="md"
                      onClick={onUnclaim}
                      disabled={claiming}
                      aria-label="Unclaim task"
                      className="h-8 w-8 p-0"
                    >
                      <UserMinus className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="md"
                      onClick={onClaim}
                      disabled={claiming}
                      aria-label="Claim task"
                      className="h-8 w-8 p-0"
                    >
                      <UserPlus className="h-4 w-4" />
                    </Button>
                  )}
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {isClaimed ? 'Unclaim task' : 'Claim task'}
                </TooltipContent>
              </Tooltip>
            )}

            {/* Initialize / Cancel — hidden for viewers */}
            {canEdit && isActive && task && task.status !== 'done' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={onCancelInitiate}
                    disabled={initiating}
                    aria-label="Cancel activity"
                    className="h-8 w-8 p-0 text-(--celune-danger) hover:text-(--celune-danger)"
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Cancel activity</TooltipContent>
              </Tooltip>
            )}
            {canEdit && canInitiate && onInitiate && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={onInitiate}
                    disabled={initiating}
                    aria-label="Initialize task"
                    className="h-8 w-8 p-0"
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Initialize task</TooltipContent>
              </Tooltip>
            )}

            {/* Close */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="md"
                  onClick={onClose}
                  aria-label="Close task drawer"
                  className="h-8 w-8 p-0"
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Close</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
}
