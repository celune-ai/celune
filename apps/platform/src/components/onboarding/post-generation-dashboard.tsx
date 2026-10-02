'use client';

import { ArrowRight, BookOpen, Target, CheckCircle2 } from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import { Dialog, DialogContent } from '@repo/ui/components/dialog';

interface PostGenerationDashboardProps {
  open: boolean;
  agentName: string;
  agentColor: string;
  learningProjectId: string;
  goalProjectId: string;
  goalProjectName: string;
  taskCount: number;
  onNavigateToProject: (projectId: string) => void;
  onClose: () => void;
}

export function PostGenerationDashboard({
  open,
  agentName,
  agentColor,
  learningProjectId,
  goalProjectId,
  goalProjectName,
  taskCount,
  onNavigateToProject,
  onClose,
}: PostGenerationDashboardProps) {
  const initials = agentName.slice(0, 2).toUpperCase();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg overflow-hidden p-0">
        <div className="flex flex-col items-center px-8 pt-10 pb-4">
          {/* Success avatar */}
          <div className="relative mb-6">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-full text-lg font-bold text-white"
              style={{ backgroundColor: agentColor }}
            >
              {initials}
            </div>
            <CheckCircle2 className="absolute -right-1 -bottom-1 h-6 w-6 text-green-500" />
          </div>

          <h2 className="text-foreground mb-1 text-xl font-semibold">You&apos;re all set</h2>
          <p className="text-muted-foreground mb-8 text-center text-sm">
            {agentName} created {taskCount} tasks across 2 projects for you.
          </p>

          {/* Project cards */}
          <div className="w-full space-y-3">
            {/* Learning Project */}
            <button
              onClick={() => onNavigateToProject(learningProjectId)}
              className="border-border hover:border-brand/40 hover:bg-brand/5 flex w-full items-center gap-4 rounded-lg border p-4 text-left transition-all"
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                <BookOpen className="h-5 w-5 text-blue-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-foreground text-sm font-medium">
                  Getting Started with Celune
                </div>
                <div className="text-muted-foreground text-xs">
                  8 interactive tasks · Start here
                </div>
              </div>
              <ArrowRight className="text-muted-foreground h-4 w-4 flex-shrink-0" />
            </button>

            {/* Goal Project */}
            <button
              onClick={() => onNavigateToProject(goalProjectId)}
              className="border-border hover:border-brand/40 hover:bg-brand/5 flex w-full items-center gap-4 rounded-lg border p-4 text-left transition-all"
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-purple-500/10">
                <Target className="h-5 w-5 text-purple-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-foreground text-sm font-medium">{goalProjectName}</div>
                <div className="text-muted-foreground text-xs">Personalized to your goals</div>
              </div>
              <ArrowRight className="text-muted-foreground h-4 w-4 flex-shrink-0" />
            </button>
          </div>
        </div>

        <div className="border-border flex items-center justify-between border-t px-6 py-4">
          <p className="text-muted-foreground text-xs">Tip: Start with Task 1 in Getting Started</p>
          <Button size="sm" onClick={() => onNavigateToProject(learningProjectId)}>
            Get Started
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
