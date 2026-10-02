'use client';

import type { LucideIcon } from 'lucide-react';
import { Button } from '@repo/ui/components/button';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="border-border flex flex-col items-center gap-4 rounded-lg border border-dashed p-12 text-center">
      <div className="bg-surface-200 flex h-12 w-12 items-center justify-center rounded-full">
        <Icon className="text-foreground-lighter h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="text-foreground text-sm font-medium">{title}</p>
        <p className="text-foreground-lighter max-w-xs text-xs leading-relaxed">{description}</p>
      </div>
      {action && (
        <Button variant="outline" size="md" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
